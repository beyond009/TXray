import dotenv from 'dotenv';
import { Config } from '../types/index.js';

dotenv.config();

export const config: Config = {
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
  etherscanApiKey: process.env.ETHERSCAN_API_KEY,
  eigenphiApiKey: process.env.EIGENPHI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || '',
  chainId: parseInt(process.env.CHAIN_ID || '1', 10),
  
  // Tenderly 配置
  tenderlyRpcUrl: process.env.TENDERLY_RPC_URL,
  useTenderlySimulation: process.env.USE_TENDERLY_SIMULATION === 'true',
};

// LLM 配置
export const llmConfig = {
  provider: process.env.LLM_PROVIDER || 'anthropic', // 'anthropic' | 'openrouter'
  model: process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022',
  baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
};

// 验证必需的配置
if (!config.anthropicApiKey) {
  console.warn('⚠️  Warning: No API key set. Please configure ANTHROPIC_API_KEY or OPENROUTER_API_KEY');
}

export default config;
