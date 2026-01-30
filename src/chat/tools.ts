/**
 * LangChain tools for the chat agent.
 * These tools allow the LLM to dynamically call analysis functions.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { analyzeTx } from '../graph/workflow.js';
import type { ProgressEvent } from '../types/index.js';

export type ToolProgressCallback = (event: ProgressEvent) => void;

/**
 * Create tools with optional progress callback for streaming.
 * 
 * SSE events emitted during analyze_transaction:
 * - rpc_done: { blockNumber }
 * - etherscan_start / etherscan_done: { abi, internalTxCount }
 * - tenderly_start / tenderly_done: { hasTrace }
 * - draft_start / draft_chunk / draft_done
 * - verify_start / verify_done: { passed, issuesCount }
 * - done: { report } ← full report for frontend UI
 */
export function createTools(onProgress?: ToolProgressCallback) {
  const analyzeTransaction = tool(
    async ({ txHash, chain }) => {
      try {
        const result = await analyzeTx(txHash, chain || 'ethereum', { onProgress });
        
        if (result.error) {
          // Emit done event with error for frontend
          onProgress?.({ 
            type: 'done', 
            payload: { 
              report: { 
                summary: `Error: ${result.error}`,
                mevType: 'unknown',
                steps: [],
                tokenFlows: [],
                technicalDetails: {}
              } 
            } 
          });
          return JSON.stringify({
            success: false,
            error: result.error,
          }, (_, v) => typeof v === 'bigint' ? v.toString() : v);
        }

        const report = result.finalReport;
        // Return concise info to LLM; full report already sent via 'done' event
        return JSON.stringify({
          success: true,
          summary: report?.summary || 'Analysis completed.',
          mevType: report?.mevPattern?.type || 'unknown',
          verification: report?.verification || null,
        }, (_, v) => typeof v === 'bigint' ? v.toString() : v);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        onProgress?.({ 
          type: 'done', 
          payload: { 
            report: { 
              summary: `Error: ${errorMsg}`,
              mevType: 'unknown',
              steps: [],
              tokenFlows: [],
              technicalDetails: {}
            } 
          } 
        });
        return JSON.stringify({
          success: false,
          error: errorMsg,
        });
      }
    },
    {
      name: 'analyze_transaction',
      description: 'Analyze an Ethereum transaction to understand what it does, including token transfers, contract interactions, and potential MEV activity. Use this when a user provides a transaction hash (0x followed by 64 hex characters) or asks about a specific transaction.',
      schema: z.object({
        txHash: z.string().describe('The transaction hash to analyze (0x + 64 hex characters)'),
        chain: z.string().optional().describe('The blockchain network (default: ethereum)'),
      }),
    }
  );

  // Placeholder for future tools
  const analyzeAddress = tool(
    async ({ address }) => {
      // TODO: Implement address analysis
      return JSON.stringify({
        success: false,
        error: 'Address analysis not yet implemented. Coming soon!',
        address,
      });
    },
    {
      name: 'analyze_address',
      description: 'Analyze an Ethereum address to understand its activity, token holdings, and transaction history. Use this when a user asks about a wallet or contract address.',
      schema: z.object({
        address: z.string().describe('The Ethereum address to analyze (0x + 40 hex characters)'),
      }),
    }
  );

  return [analyzeTransaction, analyzeAddress];
}

export const toolNames = ['analyze_transaction', 'analyze_address'];
