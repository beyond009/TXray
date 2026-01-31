import { z } from 'zod';
import { TenderlySimulationResult } from '../tools/tenderly.js';

/**
 * 交易基础信息
 */
export const TransactionSchema = z.object({
  hash: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  value: z.string(),
  gasUsed: z.string(),
  gasPrice: z.string(),
  blockNumber: z.number(),
  input: z.string(),
  logs: z.array(z.any()).optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

/**
 * 解码后的函数调用
 */
export interface DecodedCall {
  contract: string;
  functionName: string;
  params?: Record<string, any>; // 原始 params（对象形式）
  args?: any[]; // ABI 解码后的参数（数组形式）
  value?: string;
}

/**
 * 代币流转信息
 */
export interface TokenFlow {
  token: string;
  from: string;
  to: string;
  amount: string;
  symbol?: string;
  name?: string;
  decimals?: string;
}

/**
 * 内部交易信息
 */
export interface InternalTransaction {
  from: string;
  to: string;
  value: string;
  type: string;
  gas?: string;
  gasUsed?: string;
  isError?: string;
}

/**
 * Enriched info for an address in the call trace
 */
export interface CallTraceAddressInfo {
  label: string | null;
  isContract: boolean;
  abi?: any[] | null;
  source?: string | null;
}

/**
 * Flattened call with depth for step-by-step explanation
 */
export interface FlattenedCall {
  depth: number;
  index: number;
  type: string;
  from: string;
  to: string;
  value: string;
  gas?: string;
  gasUsed?: string;
  input?: string;
  functionSelector?: string;
  decodedInput?: any;
}

/**
 * 地址标签信息
 */
export interface AddressLabel {
  address: string;
  label: string | null;
  contractName?: string | null;
}

/**
 * MEV 模式类型
 */
export type MEVType = 
  | 'sandwich'
  | 'arbitrage'
  | 'liquidation'
  | 'jit_liquidity'
  | 'frontrun'
  | 'unknown';

/**
 * MEV 模式识别结果
 */
export interface MEVPattern {
  type: MEVType;
  confidence: number;
  details: {
    profit?: string;
    victim?: string;
    protocols?: string[];
    [key: string]: any;
  };
}

/**
 * LangGraph 状态定义
 */
export interface AnalysisState {
  // Input
  txHash: string;
  chain: string;
  
  // Extract stage
  rawTx?: Transaction;
  decodedCalls?: DecodedCall[];
  tokenFlows?: TokenFlow[];
  
  // 内部交易 - 两个数据源
  etherscanInternalTxs?: InternalTransaction[]; // Etherscan 的简化视图（ETH 流转）
  tenderlyCallTrace?: TenderlySimulationResult | null; // Tenderly 的完整调用轨迹
  internalTxs?: InternalTransaction[]; // 统一视图（向后兼容，优先使用 Tenderly）
  
  addressLabels?: Record<string, string>; // address -> label
  contractABI?: any[] | null; // 合约 ABI（用于解码）
  contractSource?: string | null; // 合约源码（用于深入分析）
  gasContext?: {
    currentPrice: string;
    baseFee: string;
    isAbnormal: boolean;
  };
  
  // Rules stage (跳过 MVP)

  // CallTrace stage (address enrichment + LLM step explanation)
  callTraceEnrichment?: Record<string, CallTraceAddressInfo>;
  flattenedCalls?: FlattenedCall[];
  callTraceExplanation?: string;

  // Draft stage
  draftExplanation?: string;

  // Verify stage
  verificationResult?: {
    passed: boolean;
    issues: string[];
  };

  // Output
  finalReport?: {
    summary: string;
    mevType: MEVType;
    steps: string[];
    tokenFlows: TokenFlow[];
    technicalDetails: Record<string, any>;
    verification?: { passed: boolean; issues: string[] };
    callTraceExplanation?: string;
    tenderlyCallTrace?: any;
    etherscanInternalTxs?: InternalTransaction[];
  };
  
  // Error handling
  error?: string;
}

/**
 * 工具配置
 */
export interface Config {
  rpcUrl: string;
  etherscanApiKey?: string;
  eigenphiApiKey?: string;
  anthropicApiKey: string;
  chainId: number;
  
  tenderlyRpcUrl?: string;
  useTenderlySimulation?: boolean;
  enableVerification?: boolean;
}

/**
 * LLM 配置
 */
export interface LLMConfig {
  provider: 'anthropic' | 'openrouter';
  model: string;
  baseURL?: string;
}

/**
 * Progress events for streaming pipeline steps (e.g. to SSE).
 * Payloads contain raw API response data for frontend display.
 */
export type ProgressEvent =
  | { type: 'rpc_done'; payload: { rawTx: any; receipt: any; tokenFlows: any[] } }
  | { type: 'etherscan_start' }
  | {
      type: 'etherscan_done';
      payload: {
        contractABI: any[] | null;
        contractSource: string | null;
        decodedFunction: any;
        addressLabels: Record<string, string>;
        internalTxs: any[];
        gasContext: { gasPrice: string | null; baseFee: string | null } | null;
      };
    }
  | { type: 'tenderly_start' }
  | { type: 'tenderly_done'; payload: { trace: any; calls: any[] } }
  | { type: 'calltrace_enrich_start' }
  | { type: 'calltrace_enrich_done'; payload: { addressesEnriched: number } }
  | { type: 'calltrace_explain_start' }
  | { type: 'calltrace_explain_done'; payload?: { explanationLength: number } }
  | { type: 'draft_start' }
  | { type: 'draft_chunk'; content: string }
  | { type: 'draft_done' }
  | { type: 'verify_start' }
  | { type: 'verify_done'; payload?: { passed: boolean; issuesCount: number } }
  | { type: 'done'; payload: { report: any } }
  | { type: 'error'; message: string; step?: string };
