import axios from 'axios';
import { config } from '../config/index.js';

// Etherscan API V2 - 统一所有链的 API
const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = 1; // 1 = Ethereum Mainnet

/**
 * 获取合约 ABI
 */
export async function getContractABI(address: string): Promise<any[] | null> {
  if (!config.etherscanApiKey) {
    console.warn('Etherscan API key not configured, skipping ABI fetch');
    return null;
  }

  try {
    console.log(`      [Contract ABI] Fetching for ${address.slice(0, 10)}...`);
    const response = await axios.get(ETHERSCAN_API, {
      params: {
        chainid: CHAIN_ID,
        module: 'contract',
        action: 'getabi',
        address,
        apikey: config.etherscanApiKey,
      },
      timeout: 10000, // 10秒超时
    });

    console.log(`      [Contract ABI] Response: ${response.data.status} - ${response.data.message}`);

    if (response.data.status === '1') {
      const abi = JSON.parse(response.data.result);
      console.log(`      [Contract ABI] ✓ Found ABI with ${abi.length} entries`);
      return abi;
    }
    
    console.log(`      [Contract ABI] Contract not verified or ABI not available`);
    return null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        console.log(`      [Contract ABI] ⏱️  Timeout`);
      } else {
        console.log(`      [Contract ABI] ⚠️  Error: ${error.message}`);
      }
    }
    return null;
  }
}

/**
 * 获取合约源码
 */
export async function getContractSource(address: string): Promise<string | null> {
  if (!config.etherscanApiKey) {
    return null;
  }

  try {
    const response = await axios.get(ETHERSCAN_API, {
      params: {
        chainid: CHAIN_ID,
        module: 'contract',
        action: 'getsourcecode',
        address,
        apikey: config.etherscanApiKey,
      },
      timeout: 10000,
    });

    if (response.data.status === '1' && response.data.result[0]) {
      return response.data.result[0].SourceCode;
    }
    return null;
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === 'ETIMEDOUT') {
      console.log(`      [Contract Source] ⏱️  Timeout`);
    }
    return null;
  }
}

/**
 * 获取合约名称 (从 Etherscan)
 */
export async function getContractName(address: string): Promise<string | null> {
  if (!config.etherscanApiKey) {
    console.log(`      [Contract Name] Skipped (no API key)`);
    return null;
  }

  try {
    console.log(`      [Contract Name] Fetching for ${address.slice(0, 10)}...`);
    const response = await axios.get(ETHERSCAN_API, {
      params: {
        chainid: CHAIN_ID,
        module: 'contract',
        action: 'getsourcecode',
        address,
        apikey: config.etherscanApiKey,
      },
      timeout: 10000, // 10秒超时
    });

    console.log(`      [Contract Name] Response: ${response.data.status} - ${response.data.message}`);
    
    // 显示详细错误信息
    if (response.data.status === '0') {
      console.log(`      [Contract Name] ⚠️  API Error: ${response.data.result}`);
    }

    if (response.data.status === '1' && response.data.result[0]) {
      const contractName = response.data.result[0].ContractName;
      if (contractName) {
        console.log(`      [Contract Name] ✓ Found: ${contractName}`);
        return contractName;
      }
    }
    
    console.log(`      [Contract Name] Contract not verified or no name available`);
    return null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        console.log(`      [Contract Name] ⏱️  Timeout after 10s`);
      } else {
        console.log(`      [Contract Name] ⚠️  Error: ${error.message}`);
      }
    }
    return null;
  }
}

/**
 * Get address label (nametag) - 只使用本地数据库
 * 
 * Priority:
 * 1. Local database (instant, free) ✅
 * 2. Return null (不再调用 Etherscan API，避免速率限制)
 * 
 * Note: 为了避免 Etherscan API 速率限制，此函数不再调用任何外部 API。
 * 
 * Alternative solutions for comprehensive labels:
 * - MetaSleuth API (25+ chains, entity/attribute/nametag)
 * - Flipside Crypto + AddressInf0DB (local database)
 * - OKLink API (multi-chain support)
 * - Manual curation in local database
 */
export async function getAddressLabel(address: string): Promise<string | null> {
  // 只检查本地数据库
  const { getKnownAddressLabel } = await import('./known-addresses.js');
  const knownLabel = getKnownAddressLabel(address);
  if (knownLabel) {
    console.log(`      [Nametag] ✓ Found in local DB: ${knownLabel}`);
    return knownLabel;
  }

  // 不再调用 Etherscan API，避免速率限制
  return null;
}

/**
 * 获取交易的内部调用
 */
export async function getInternalTransactions(txHash: string): Promise<any[]> {
  if (!config.etherscanApiKey) {
    console.log(`      [Internal Txs] Skipped (no API key)`);
    return [];
  }

  try {
    console.log(`      [Internal Txs] Fetching for ${txHash.slice(0, 10)}...`);
    const response = await axios.get(ETHERSCAN_API, {
      params: {
        chainid: CHAIN_ID,
        module: 'account',
        action: 'txlistinternal',
        txhash: txHash,
        apikey: config.etherscanApiKey,
      },
      timeout: 10000,
    });

    if (response.data.status === '1' && Array.isArray(response.data.result)) {
      console.log(`      [Internal Txs] ✓ Found ${response.data.result.length} internal transactions`);
      return response.data.result;
    }
    
    console.log(`      [Internal Txs] No internal transactions found`);
    return [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        console.log(`      [Internal Txs] ⏱️  Timeout`);
      } else {
        console.log(`      [Internal Txs] ⚠️  Error: ${error.message}`);
      }
    }
    return [];
  }
}

/**
 * 获取代币信息
 */
export async function getTokenInfo(tokenAddress: string): Promise<{
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  totalSupply: string | null;
} | null> {
  if (!config.etherscanApiKey) {
    return null;
  }

  try {
    console.log(`      [Token Info] Fetching for ${tokenAddress.slice(0, 10)}...`);
    
    // 并行获取代币信息
    const [nameRes, supplyRes] = await Promise.all([
      axios.get(ETHERSCAN_API, {
        params: {
          chainid: CHAIN_ID,
          module: 'token',
          action: 'tokeninfo',
          contractaddress: tokenAddress,
          apikey: config.etherscanApiKey,
        },
        timeout: 10000,
      }).catch((err) => {
        console.log(`      [Token Info] Name fetch error: ${err.message}`);
        return null;
      }),
      axios.get(ETHERSCAN_API, {
        params: {
          chainid: CHAIN_ID,
          module: 'stats',
          action: 'tokensupply',
          contractaddress: tokenAddress,
          apikey: config.etherscanApiKey,
        },
        timeout: 10000,
      }).catch(() => null),
    ]);

    // tokeninfo API 返回多个字段
    if (nameRes?.data.status === '1' && nameRes.data.result) {
      const info = Array.isArray(nameRes.data.result) 
        ? nameRes.data.result[0] 
        : nameRes.data.result;
      
      const tokenInfo = {
        name: info.name || info.tokenName || null,
        symbol: info.symbol || null,
        decimals: info.decimals || info.divisor || null,
        totalSupply: supplyRes?.data?.result || null,
      };
      
      console.log(`      [Token Info] ✓ ${tokenInfo.symbol} (${tokenInfo.name})`);
      return tokenInfo;
    }
    
    console.log(`      [Token Info] No info found`);
    return null;
  } catch (error) {
    console.log(`      [Token Info] Error: ${error}`);
    return null;
  }
}

/**
 * 获取历史 Gas 价格
 */
export async function getGasPriceAtBlock(_blockNumber: number): Promise<{
  gasPrice: string | null;
  baseFee: string | null;
} | null> {
  if (!config.etherscanApiKey) {
    return null;
  }

  try {
    // 获取当前 Gas 价格作为参考
    const response = await axios.get(ETHERSCAN_API, {
      params: {
        chainid: CHAIN_ID,
        module: 'gastracker',
        action: 'gasoracle',
        apikey: config.etherscanApiKey,
      },
      timeout: 10000,
    });

    if (response.data.status === '1' && response.data.result) {
      return {
        gasPrice: response.data.result.ProposeGasPrice || null,
        baseFee: response.data.result.suggestBaseFee || null,
      };
    }
    return null;
  } catch (error) {
    return null;
  }
}
