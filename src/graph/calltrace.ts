/**
 * CallTrace enrichment and explanation.
 * Enriches addresses in the trace (labels, ABI) and produces step-by-step LLM explanation.
 */
import { getProgress } from '../chat/progress.js';
import { getAddressLabel, getContractABI, getContractSource } from '../tools/etherscan.js';
import { isContract } from '../tools/rpc.js';
import { extractAllCallsFromTrace } from '../tools/tenderly-trace.js';
import type { CallTrace } from '../tools/tenderly.js';
import type {
  AnalysisState,
  CallTraceAddressInfo,
  FlattenedCall,
  InternalTransaction,
} from '../types/index.js';

const MAX_ADDRESSES_TO_ENRICH = 20;

function extractUniqueAddressesFromCalls(
  calls: Array<{ from?: string; to?: string }>
): string[] {
  const set = new Set<string>();
  for (const c of calls) {
    if (c.from) set.add(c.from.toLowerCase());
    if (c.to) set.add(c.to.toLowerCase());
  }
  return Array.from(set);
}

function flattenCallTrace(call: CallTrace, depth = 0, startIndex = { n: 0 }): FlattenedCall[] {
  const result: FlattenedCall[] = [];
  const sel = call.input?.slice(0, 10) || '';
  result.push({
    depth,
    index: startIndex.n++,
    type: call.type || 'CALL',
    from: call.from,
    to: call.to,
    value: call.value || '0',
    gas: call.gas,
    gasUsed: call.gasUsed,
    input: call.input,
    functionSelector: sel !== '0x' ? sel : undefined,
    decodedInput: (call as any).decodedInput,
  });
  if (call.calls) {
    for (const sub of call.calls) {
      result.push(...flattenCallTrace(sub, depth + 1, startIndex));
    }
  }
  return result;
}

export async function callTraceEnrichNode(
  state: AnalysisState
): Promise<Partial<AnalysisState>> {
  if (state.error || !state.rawTx) return {};

  const calls = state.tenderlyCallTrace?.trace?.[0]
    ? extractAllCallsFromTrace(state.tenderlyCallTrace.trace[0])
    : (state.internalTxs || []).map((itx: InternalTransaction) => ({
        from: itx.from,
        to: itx.to,
        value: itx.value,
        type: itx.type,
      }));

  if (calls.length === 0) {
    return {
      flattenedCalls: [],
      callTraceEnrichment: {},
    };
  }

  getProgress()?.({ type: 'calltrace_enrich_start' });
  console.log('🔗 [CallTrace] Enriching addresses in trace...');

  const addresses = extractUniqueAddressesFromCalls(calls);
  const toEnrich = addresses.slice(0, MAX_ADDRESSES_TO_ENRICH);
  const enrichment: Record<string, CallTraceAddressInfo> = {};

  for (const addr of toEnrich) {
    try {
      const label = await getAddressLabel(addr);
      const isContractAddr = await isContract(addr);
      let abi: any[] | null = null;
      let source: string | null = null;
      if (isContractAddr) {
        [abi, source] = await Promise.all([
          getContractABI(addr),
          getContractSource(addr).then((s) =>
            s && s.length > 30000 ? s.slice(0, 30000) + '\n/* truncated */' : s
          ),
        ]);
      }
      enrichment[addr.toLowerCase()] = {
        label: label || null,
        isContract: isContractAddr,
        abi: abi || undefined,
        source: source || undefined,
      };
    } catch (e) {
      console.warn(`   [CallTrace] Failed to enrich ${addr.slice(0, 10)}...:`, e);
      enrichment[addr.toLowerCase()] = {
        label: null,
        isContract: false,
      };
    }
  }

  let flattenedCalls: FlattenedCall[] = [];
  if (state.tenderlyCallTrace?.trace?.[0]) {
    flattenedCalls = flattenCallTrace(state.tenderlyCallTrace.trace[0]);
  } else {
    flattenedCalls = (state.internalTxs || []).map((itx, i) => ({
      depth: 0,
      index: i,
      type: itx.type || 'CALL',
      from: itx.from,
      to: itx.to,
      value: itx.value || '0',
      gas: (itx as any).gas,
      gasUsed: (itx as any).gasUsed,
      input: (itx as any).input,
    }));
  }

  getProgress()?.({ type: 'calltrace_enrich_done', payload: { addressesEnriched: toEnrich.length } });
  console.log(`   ✓ Enriched ${toEnrich.length} addresses, ${flattenedCalls.length} calls`);

  return {
    callTraceEnrichment: enrichment,
    flattenedCalls,
  };
}

export function buildCallTraceExplainPrompt(state: AnalysisState): string {
  const calls = state.flattenedCalls || [];
  const enrichment = state.callTraceEnrichment || {};
  const labels = state.addressLabels || {};

  const fmt = (addr: string) => {
    const a = addr.toLowerCase();
    const e = enrichment[a];
    const l = labels[addr] || e?.label;
    return l ? `${addr.slice(0, 10)}... [${l}]` : addr.slice(0, 14) + '...';
  };

  const lines = calls.slice(0, 80).map((c, i) => {
    const indent = '  '.repeat(c.depth);
    const valueEth = (Number(c.value) / 1e18).toFixed(6);
    return `${indent}${i + 1}. ${c.type} ${fmt(c.from)} → ${fmt(c.to)} | value: ${valueEth} ETH | selector: ${c.functionSelector || 'N/A'}`;
  });

  const enrichmentTable = Object.entries(enrichment)
    .map(([addr, info]) => `- ${addr}: ${info.label || 'unknown'} | contract: ${info.isContract} | ABI: ${info.abi?.length || 0} entries`)
    .join('\n');

  return `You are analyzing a transaction's call trace. Explain each call step-by-step.

## Flattened Call Trace (${calls.length} calls, showing up to 80)
\`\`\`
${lines.join('\n')}
${calls.length > 80 ? `... and ${calls.length - 80} more calls` : ''}
\`\`\`

## Address Enrichment
${enrichmentTable || 'No enrichment'}

## Task
For each numbered step, briefly explain:
1. Who called whom (use labels when available)
2. What the call likely does (based on selector, type, value)
3. How it fits into the overall flow (e.g. "swap step", "approve", "liquidation")

Be concise. Use the address labels. For DELEGATECALL, note that the caller's code runs in the callee's context.
Output a clear step-by-step explanation.`;
}

export async function callTraceExplainNode(
  state: AnalysisState
): Promise<Partial<AnalysisState>> {
  if (state.error || !state.rawTx) return {};

  const calls = state.flattenedCalls || [];
  if (calls.length === 0) {
    return { callTraceExplanation: 'No call trace available.' };
  }

  getProgress()?.({ type: 'calltrace_explain_start' });
  console.log('📝 [CallTrace] Explaining trace with LLM...');

  try {
    const { config, llmConfig } = await import('../config/index.js');
    const { ChatAnthropic } = await import('@langchain/anthropic');
    const { ChatOpenAI } = await import('@langchain/openai');

    const llm =
      llmConfig.provider === 'openrouter'
        ? new ChatOpenAI({
            apiKey: config.anthropicApiKey,
            model: llmConfig.model,
            temperature: 0,
            configuration: { baseURL: llmConfig.baseURL },
          })
        : new ChatAnthropic({
            apiKey: config.anthropicApiKey,
            model: llmConfig.model,
            temperature: 0,
          });

    const prompt = buildCallTraceExplainPrompt(state);
    const response = await llm.invoke(prompt);
    const explanation = response.content.toString();

    getProgress()?.({
      type: 'calltrace_explain_done',
      payload: { explanationLength: explanation.length },
    });
    console.log(`   ✓ Explanation: ${explanation.length} chars`);

    return { callTraceExplanation: explanation };
  } catch (err) {
    console.warn('   [CallTrace] Explain failed:', err);
    return {
      callTraceExplanation: `Failed to explain call trace: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
