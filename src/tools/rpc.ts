import { createPublicClient, http, type Hash, type TransactionReceipt } from 'viem';
import { mainnet } from 'viem/chains';
import { config } from '../config/index.js';
import type { Transaction, TokenFlow } from '../types/index.js';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 创建 Viem 客户端
 */
export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(config.rpcUrl),
});

let KECC_DB_PATH: string | null | undefined;
const METHOD_SIG_CACHE = new Map<string, string | null>();

function resolveKeccDbPath(): string | null {
  if (KECC_DB_PATH !== undefined) return KECC_DB_PATH;

  // Most common: run from repo root
  const candidates = [
    path.resolve(process.cwd(), 'src/database/kecc4k256.db'),
    path.resolve(process.cwd(), 'database/kecc4k256.db'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      KECC_DB_PATH = p;
      return p;
    }
  }

  KECC_DB_PATH = null;
  return null;
}

function lookupMethodSignatureFromDb(
  selector: string,
  preferred?: string
): string | undefined {
  const normalizedSelector = selector.toLowerCase();
  const cached = METHOD_SIG_CACHE.get(normalizedSelector);
  if (cached !== undefined) return cached ?? undefined;

  const dbPath = resolveKeccDbPath();
  if (!dbPath) {
    METHOD_SIG_CACHE.set(normalizedSelector, null);
    return undefined;
  }

  // methods schema:
  // CREATE TABLE methods (selector TEXT, method TEXT, PRIMARY KEY(selector, method)) WITHOUT ROWID
  const sql = `SELECT method FROM methods WHERE selector='${normalizedSelector}' LIMIT 50;`;
  const res = spawnSync('sqlite3', ['-noheader', dbPath, sql], { encoding: 'utf8' });
  if (res.status !== 0) {
    METHOD_SIG_CACHE.set(normalizedSelector, null);
    return undefined;
  }

  const lines = (res.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    METHOD_SIG_CACHE.set(normalizedSelector, null);
    return undefined;
  }

  // Selector collisions exist (multiple signatures share the same 4-byte selector).
  // Strategy:
  // - If we have a "preferred" signature (from local known mapping), take it if present
  // - Else choose the shortest signature (tends to pick canonical simple forms)
  let chosen: string;
  if (preferred && lines.includes(preferred)) {
    chosen = preferred;
  } else {
    chosen = lines.slice().sort((a, b) => a.length - b.length)[0]!;
  }

  METHOD_SIG_CACHE.set(normalizedSelector, chosen);
  return chosen;
}

/**
 * 获取交易详情（增强版）
 */
export async function getTransactionDetails(txHash: Hash): Promise<Transaction> {
  try {
    const [tx, receipt] = await Promise.all([
      publicClient.getTransaction({ hash: txHash }),
      publicClient.getTransactionReceipt({ hash: txHash }),
    ]);

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      gasUsed: receipt.gasUsed.toString(),
      gasPrice: tx.gasPrice?.toString() || '0',
      blockNumber: Number(tx.blockNumber),
      input: tx.input,
      logs: receipt.logs,
    };
  } catch (error) {
    throw new Error(`Failed to fetch transaction: ${error}`);
  }
}

/**
 * 简单解码 calldata（提取函数选择器和参数）
 */
export function decodeCalldata(input: string): {
  functionSelector: string;
  functionSignature?: string;
  rawParams: string;
} {
  if (!input || input === '0x' || input.length < 10) {
    return {
      functionSelector: '0x',
      rawParams: '',
    };
  }
  
  // 函数选择器是前 4 字节 (8 个十六进制字符 + '0x')
  const functionSelector = input.slice(0, 10);
  const rawParams = input.slice(10);
  
  // 常见函数签名映射（本地兜底 + 用作“preferred”以解决 selector collision）
  const knownSelectors: Record<string, string> = {
    '0xa9059cbb': 'transfer(address,uint256)',
    '0x23b872dd': 'transferFrom(address,address,uint256)',
    '0x095ea7b3': 'approve(address,uint256)',
    '0x38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    '0x7ff36ab5': 'swapExactETHForTokens(uint256,address[],address,uint256)',
    '0x18cbafe5': 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
    '0x022c0d9f': 'swap(uint256,uint256,address,bytes)',
    '0x128acb08': 'swap(address,uint256,uint256,bytes)',
  };

  // Try local mapping first (fast & deterministic), then fallback to kecc4k256 selector DB.
  const preferred = knownSelectors[functionSelector.toLowerCase()];
  const functionSignature =
    preferred ||
    lookupMethodSignatureFromDb(functionSelector, preferred);
  
  return {
    functionSelector,
    functionSignature,
    rawParams,
  };
}

/**
 * 从日志中提取代币转账 (ERC20 Transfer events)
 */
export function extractTokenFlows(receipt: TransactionReceipt): TokenFlow[] {
  const tokenFlows: TokenFlow[] = [];
  
  // ERC20 Transfer event signature: Transfer(address,address,uint256)
  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  
  for (const log of receipt.logs) {
    if (log.topics[0] === TRANSFER_TOPIC && log.topics.length >= 3) {
      const from = '0x' + log.topics[1]?.slice(26); // Remove padding
      const to = '0x' + log.topics[2]?.slice(26);
      const amount = log.data;
      
      tokenFlows.push({
        token: log.address,
        from: from || '',
        to: to || '',
        amount,
      });
    }
  }
  
  return tokenFlows;
}

/**
 * 获取合约代码 (检查是否为合约地址)
 */
export async function getContractCode(address: Hash): Promise<string> {
  const code = await publicClient.getBytecode({ address });
  return code || '0x';
}

/**
 * 检测地址是否是合约
 * 通过检查地址的 bytecode，如果有代码则是合约
 */
export async function isContract(address: string): Promise<boolean> {
  try {
    const code = await publicClient.getBytecode({ 
      address: address as Hash 
    });
    // 如果有代码且不是 '0x'，则是合约
    return code !== undefined && code !== '0x' && code.length > 2;
  } catch (error) {
    console.log(`      [RPC] Error checking if ${address.slice(0, 10)} is contract: ${error}`);
    return false;
  }
}

/**
 * 尝试通过 RPC 调用 ERC20 标准方法来获取 token 信息
 * 这比 Etherscan API 更快，且不占用 API 配额
 */
export async function getTokenInfoFromRPC(tokenAddress: string): Promise<{
  name: string | null;
  symbol: string | null;
  decimals: number | null;
} | null> {
  try {
    // ERC20 标准方法签名
    const NAME_SELECTOR = '0x06fdde03';      // name()
    const SYMBOL_SELECTOR = '0x95d89b41';    // symbol()
    const DECIMALS_SELECTOR = '0x313ce567';  // decimals()

    // 并行调用三个方法
    const [nameResult, symbolResult, decimalsResult] = await Promise.all([
      publicClient.call({
        to: tokenAddress as Hash,
        data: NAME_SELECTOR as Hash,
      }).catch(() => ({ data: undefined })),
      publicClient.call({
        to: tokenAddress as Hash,
        data: SYMBOL_SELECTOR as Hash,
      }).catch(() => ({ data: undefined })),
      publicClient.call({
        to: tokenAddress as Hash,
        data: DECIMALS_SELECTOR as Hash,
      }).catch(() => ({ data: undefined })),
    ]);

    // 解码返回值
    const name = nameResult.data ? decodeString(nameResult.data) : null;
    const symbol = symbolResult.data ? decodeString(symbolResult.data) : null;
    const decimals = decimalsResult.data ? decodeUint8(decimalsResult.data) : null;

    // 如果至少有一个字段成功，就认为是有效的 token
    if (name || symbol || decimals !== null) {
      return { name, symbol, decimals };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 解码字符串返回值（ABI string）
 */
function decodeString(data: string): string | null {
  try {
    if (!data || data === '0x' || data.length < 66) return null;
    
    // String 的 ABI 编码：
    // 前 32 字节：offset
    // 接下来 32 字节：长度
    // 之后：实际数据
    const length = parseInt(data.slice(66, 130), 16);
    if (length === 0 || length > 1000) return null;
    
    const hexString = data.slice(130, 130 + length * 2);
    const result = Buffer.from(hexString, 'hex').toString('utf8');
    
    // 过滤掉无效字符
    return result.replace(/\0/g, '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * 解码 uint8 返回值
 */
function decodeUint8(data: string): number | null {
  try {
    if (!data || data === '0x' || data.length < 66) return null;
    const value = parseInt(data.slice(-2), 16);
    return value >= 0 && value <= 255 ? value : null;
  } catch {
    return null;
  }
}

/**
 * 批量获取区块信息
 */
export async function getBlock(blockNumber: bigint) {
  return await publicClient.getBlock({ blockNumber });
}
