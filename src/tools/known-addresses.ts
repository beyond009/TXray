/**
 * 地址标签数据库
 *
 * 当前优先使用本地 SQLite 数据库 `src/database/addressInf0.db`（AddressInf0DB 风格）
 * - 表: info(chainID, address, name, label, labelType, labelSubtype)
 * - 主键: (chainID, address)
 *
 * 同时保留少量硬编码 `KNOWN_ADDRESSES` 作为最终兜底/手工覆盖。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const KNOWN_ADDRESSES: Record<string, string> = {
  // Uniswap
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2: Router',
  '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3: Router',
  '0xc36442b4a4522e871399cd717abdd847ab11fe88': 'Uniswap V3: Positions NFT',
  
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance 14',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance 15',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': 'Binance 16',
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f': 'Binance Hot Wallet 1',
  
  // Other Exchanges
  '0x3cd751e6b0078be393132286c442345e5dc49699': 'Coinbase 1',
  '0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511': 'Coinbase 5',
  '0xeb2629a2734e272bcc07bda959863f316f4bd4cf': 'Coinbase 2',
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': 'Coinbase: Miscellaneous',
  
  // DEX
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f': 'SushiSwap: Router',
  '0x1111111254fb6c44bac0bed2854e76f90643097d': '1inch v4: Router',
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 'Uniswap V3: Router 2',
  
  // Curve
  '0xbebe82bab7ba07830d9d5e0e8e4d4a54b0f10b95': 'Curve.fi: Registry',
  '0x99a58482bd75cbab83b27ec03ca68ff489b5788f': 'Curve.fi: Swap Router',
  '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7': 'Curve: 3pool (DAI/USDC/USDT)',
  '0x52ea46506b9cc5ef470c5bf89f17dc28bb35d85c': 'Curve: USDT Swap',
  '0xd51a44d3fae010294c616388b506acda1bfaae46': 'Curve: Tricrypto (USDT/WBTC/WETH)',
  
  // Uniswap V3 Pools
  '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640': 'Uniswap V3: WETH/USDC 0.3%',
  '0x3416cf6c708da44db2624d63ea0aaef7113527c6': 'Uniswap V3: USDC/USDT 0.04%',
  
  // Compound
  '0x39aa39c021dfbae8fac545936693ac917d5e7563': 'Compound: cUSDC',
  
  // Aave
  '0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9': 'Aave: Lending Pool V2',
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': 'Aave V3: Pool',
  
  '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b': 'Compound: Comptroller',
  
  // MakerDAO
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': 'Maker: MKR Token',
  
  // Wrapped Tokens
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'Wrapped Ether',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'Wrapped BTC',
  
  // Stablecoins
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USD Coin',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'Tether USD',
  '0x4fabb145d64652a948d72533023f6e7a623c7c53': 'Binance USD',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'Dai Stablecoin',
  
  // NFT Marketplaces
  '0x00000000006c3852cbef3e08e8df289169ede581': 'OpenSea: Seaport 1.1',
  '0x7f268357a8c2552623316e2562d90e642bb538e5': 'OpenSea: Wyvern Exchange v2',
  
  // MEV Bots (known)
  '0x00000000003b3cc22af3ae1eac0440bcee416b40': 'MEV Bot',
  '0x000000000035b5e5ad9019092c665357240f594e': 'MEV Bot',
  '0xbadc0defafcf6d4239bdf0b66da4d7bd36fcf05a': 'MEV Bot',
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': 'Uniswap: Universal Router',
};

type ChainID = number;
type AddressLabelCache = Map<string, string>;

// Cache only the addresses we've looked up, to avoid huge sqlite3 stdout (ENOBUFS).
const DB_CACHE_BY_CHAIN = new Map<ChainID, AddressLabelCache>();
let DB_PATH: string | null | undefined;

function resolveDbPath(): string | null {
  if (DB_PATH !== undefined) return DB_PATH;

  // Most common: run from repo root (tsx src/... or node dist/... with cwd at repo root)
  const candidates = [
    path.resolve(process.cwd(), 'src/database/addressInf0.db'),
    path.resolve(process.cwd(), 'database/addressInf0.db'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      DB_PATH = p;
      return p;
    }
  }

  DB_PATH = null;
  return null;
}

function getChainCache(chainID: ChainID): AddressLabelCache {
  const existing = DB_CACHE_BY_CHAIN.get(chainID);
  if (existing) return existing;
  const created: AddressLabelCache = new Map();
  DB_CACHE_BY_CHAIN.set(chainID, created);
  return created;
}

function queryLabelFromSqlite(chainID: ChainID, normalizedAddress: string): string | null {
  const dbPath = resolveDbPath();
  if (!dbPath) return null;

  // Use sqlite3 CLI to avoid adding native Node dependencies.
  // Output: a single line label (or empty).
  const sql = `
SELECT
  COALESCE(
    NULLIF(trim(label), ''),
    NULLIF(trim(name), '')
  ) AS label
FROM info
WHERE chainID = ${Number(chainID)}
  AND lower(address) = lower('${normalizedAddress}')
LIMIT 1;
`.trim();

  const res = spawnSync('sqlite3', ['-noheader', dbPath, sql], { encoding: 'utf8' });
  if (res.status !== 0) return null;

  const out = (res.stdout ?? '').trim();
  return out ? out : null;
}

/**
 * 从本地数据库获取地址标签
 */
export function getKnownAddressLabel(address: string, chainID: ChainID = 1): string | null {
  const normalizedAddress = address.toLowerCase();

  // 1) SQLite DB
  const cache = getChainCache(chainID);
  const cached = cache.get(normalizedAddress);
  if (cached) return cached;

  const fromDb = queryLabelFromSqlite(chainID, normalizedAddress);
  if (fromDb) {
    cache.set(normalizedAddress, fromDb);
    return fromDb;
  }

  // 2) Hardcoded fallback / manual overrides
  return KNOWN_ADDRESSES[normalizedAddress] || null;
}

/**
 * 添加新的已知地址
 */
export function addKnownAddress(address: string, label: string): void {
  KNOWN_ADDRESSES[address.toLowerCase()] = label;
}
