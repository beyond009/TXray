import { createPublicClient, http, type Hash } from 'viem';
import { mainnet } from 'viem/chains';
import { config } from '../config/index.js';

/**
 * Tenderly 客户端
 */
export const tenderlyClient = config.tenderlyRpcUrl 
  ? createPublicClient({
      chain: mainnet,
      transport: http(config.tenderlyRpcUrl),
    })
  : null;

/**
 * Tenderly 模拟交易接口
 */
export interface TenderlySimulationParams {
  from?: string;
  to: string;
  gas?: string;
  gasPrice?: string;
  value?: string;
  input: string;
  blockNumber?: string | 'latest';
  stateOverrides?: Record<string, StateOverride>;
  blockOverrides?: BlockOverride;
}

export interface StateOverride {
  nonce?: string;
  code?: string;
  balance?: string;
  stateDiff?: Record<string, string>;
}

export interface BlockOverride {
  number?: string;
  difficulty?: string;
  time?: string;
  gasLimit?: string;
  coinbase?: string;
  random?: string;
  baseFee?: string;
}

/**
 * Tenderly 模拟结果
 */
export interface TenderlySimulationResult {
  // 基础信息
  gasUsed: string;
  gasPrice?: string;
  status: boolean;
  
  // 解码后的调用轨迹
  trace: CallTrace[];
  
  // 日志（已解码）
  logs: DecodedLog[];
  
  // 资产变化
  assetChanges?: AssetChange[];
  
  // 状态变化
  stateChanges?: StateChange[];
  
  // 余额变化
  balanceChanges?: BalanceChange[];
  
  // Nonce 变化
  nonceChange?: NonceChange[];
  
  // 代码变化
  codeChange?: CodeChange[];
}

export interface CallTrace {
  type: string; // CALL, DELEGATECALL, STATICCALL, CREATE, etc.
  from: string;
  to: string;
  value?: string;
  gas?: string;
  gasUsed?: string;
  input?: string;
  output?: string;
  error?: string;
  calls?: CallTrace[]; // 嵌套调用
  
  // Tenderly 特有的解码信息
  function?: string;
  functionSignature?: string;
  decodedInput?: any;
  decodedOutput?: any;
}

export interface DecodedLog {
  address: string;
  topics: string[];
  data: string;
  
  // 解码后的信息
  name?: string;
  signature?: string;
  decoded?: any;
}

export interface AssetChange {
  address: string;
  tokenId?: string;
  amount?: string;
  from?: string;
  to?: string;
  type: 'transfer' | 'mint' | 'burn';
  tokenInfo?: {
    symbol?: string;
    name?: string;
    decimals?: number;
  };
}

export interface StateChange {
  address: string;
  slot: string;
  original: string;
  dirty: string;
}

export interface BalanceChange {
  address: string;
  original: string;
  dirty: string;
  delta: string;
}

export interface NonceChange {
  address: string;
  original: string;
  dirty: string;
}

export interface CodeChange {
  address: string;
  original?: string;
  dirty: string;
}

/**
 * 使用 Tenderly 模拟交易
 */
export async function simulateTransaction(
  txHash: string
): Promise<TenderlySimulationResult | null> {
  if (!tenderlyClient) {
    console.log('   ⚠️  Tenderly RPC not configured');
    return null;
  }

  try {
    console.log(`   🎭 [Tenderly] Simulating transaction ${txHash.slice(0, 10)}...`);
    
    // 先获取原始交易
    const tx = await tenderlyClient.getTransaction({ hash: txHash as Hash });
    
    // 使用 tenderly_simulateTransaction
    const result = await tenderlyClient.request({
      method: 'tenderly_simulateTransaction' as any,
      params: [
        {
          from: tx.from,
          to: tx.to,
          gas: `0x${tx.gas.toString(16)}`,
          gasPrice: tx.gasPrice ? `0x${tx.gasPrice.toString(16)}` : undefined,
          value: `0x${tx.value.toString(16)}`,
          input: tx.input,
        },
        `0x${tx.blockNumber!.toString(16)}`, // 在原始区块上模拟
      ] as any,
    });

    const simResult = result as any as TenderlySimulationResult;
    
    console.log(`   ✅ [Tenderly] Simulation completed`);
    console.log(`      Gas Used: ${simResult.gasUsed || 'N/A'}`);
    console.log(`      Status: ${simResult.status ? 'Success' : 'Failed'}`);
    console.log(`      Trace Calls: ${simResult.trace?.length || 0}`);
    console.log(`      Logs: ${simResult.logs?.length || 0}`);
    console.log(`      Asset Changes: ${simResult.assetChanges?.length || 0}`);
    console.log(`      Balance Changes: ${simResult.balanceChanges?.length || 0}`);

    return simResult;
  } catch (error) {
    console.error('   ❌ [Tenderly] Simulation failed:', error);
    return null;
  }
}

/**
 * 模拟一个新的交易（不基于历史交易）
 */
export async function simulateNewTransaction(
  params: TenderlySimulationParams
): Promise<TenderlySimulationResult | null> {
  if (!tenderlyClient) {
    console.log('   ⚠️  Tenderly RPC not configured');
    return null;
  }

  try {
    console.log(`   🎭 [Tenderly] Simulating new transaction to ${params.to.slice(0, 10)}...`);
    
    const result = await tenderlyClient.request({
      method: 'tenderly_simulateTransaction' as any,
      params: [
        params,
        params.blockNumber || 'latest',
        params.stateOverrides,
        params.blockOverrides,
      ] as any,
    });

    console.log(`   ✅ [Tenderly] Simulation completed`);
    return result as any as TenderlySimulationResult;
  } catch (error) {
    console.error('   ❌ [Tenderly] Simulation failed:', error);
    return null;
  }
}

/**
 * 从 Tenderly 模拟结果提取所有内部调用
 */
export function extractAllCalls(trace: CallTrace[]): CallTrace[] {
  const allCalls: CallTrace[] = [];
  
  function traverse(call: CallTrace) {
    allCalls.push(call);
    if (call.calls) {
      call.calls.forEach(traverse);
    }
  }
  
  trace.forEach(traverse);
  return allCalls;
}

/**
 * 从 Tenderly 结果提取代币转账信息
 */
export function extractTokenTransfers(result: TenderlySimulationResult) {
  if (!result.assetChanges) return [];
  
  return result.assetChanges
    .filter(change => change.type === 'transfer')
    .map(change => ({
      token: change.address,
      from: change.from!,
      to: change.to!,
      amount: change.amount!,
      symbol: change.tokenInfo?.symbol,
      name: change.tokenInfo?.name,
      decimals: change.tokenInfo?.decimals,
    }));
}

/**
 * 分析 Gas 使用情况
 */
export function analyzeGasUsage(trace: CallTrace[]): {
  totalGas: bigint;
  byContract: Record<string, bigint>;
  byFunction: Record<string, bigint>;
} {
  const byContract: Record<string, bigint> = {};
  const byFunction: Record<string, bigint> = {};
  let totalGas = 0n;
  
  for (const call of extractAllCalls(trace)) {
    const gasUsed = call.gasUsed ? BigInt(call.gasUsed) : 0n;
    totalGas += gasUsed;
    
    // 按合约统计
    if (call.to) {
      byContract[call.to] = (byContract[call.to] || 0n) + gasUsed;
    }
    
    // 按函数统计
    if (call.function) {
      byFunction[call.function] = (byFunction[call.function] || 0n) + gasUsed;
    }
  }
  
  return { totalGas, byContract, byFunction };
}
