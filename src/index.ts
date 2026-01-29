/**
 * MEV Agent - Main Entry Point
 */

export { analyzeTx, createMEVAnalyzer } from './graph/workflow.js';
export { getTransactionDetails, extractTokenFlows } from './tools/rpc.js';
export { getContractABI, getContractName } from './tools/etherscan.js';
export { identifyMEVPattern } from './mev/patterns.js';
export type { AnalysisState, Transaction, TokenFlow, MEVPattern, MEVType } from './types/index.js';

// 如果直接运行
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('MEV Agent - Use CLI tool: npm run analyze -- <tx_hash>');
}
