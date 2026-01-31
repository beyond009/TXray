# SSE Progress Events (onProgress)

The chat API streams progress via Server-Sent Events. Each event has an **event type** and **data** (JSON).

Server logic: `data = event.payload ?? (event.content ? { content: event.content } : {})`.

---

## All ProgressEvent types and data

| Event type        | When emitted                    | SSE `data` (raw API data for frontend) |
|-------------------|----------------------------------|----------------------------------------|
| **rpc_done**     | RPC fetched tx receipt          | `{ rawTx, receipt, tokenFlows }`       |
| **etherscan_start** | Before Etherscan calls        | `{}`                                   |
| **etherscan_done**  | After Etherscan (ABI, internal txs) | `{ contractABI, contractSource, decodedFunction, addressLabels, internalTxs, gasContext }` |
| **tenderly_start** | Before Tenderly trace          | `{}`                                   |
| **tenderly_done**  | After Tenderly trace           | `{ trace, calls }`                     |
| **calltrace_enrich_start** | Before enriching trace addresses | `{}`                    |
| **calltrace_enrich_done**  | After enrichment              | `{ addressesEnriched: number }`        |
| **calltrace_explain_start** | Before LLM explains trace  | `{}`                    |
| **calltrace_explain_done**  | After explanation            | `{ explanationLength: number }`        |
| **draft_start**  | LLM analysis started (in tx workflow or agent) | `{}` |
| **draft_chunk**  | *(defined in types; not currently emitted)* | `{ content: string }` |
| **draft_done**   | LLM finished generating         | `{}`                                |
| **verify_start** | Fact-check started              | `{}`                                |
| **verify_done**  | Fact-check finished             | `{ passed: boolean, issuesCount: number }` or `{}` |
| **done**         | Full tx report ready            | `{ report: Report }`                |
| **error**        | Something failed               | `{ message: string, step?: string }` |

---

## Chat-only events (no tool call)

When the user sends a normal message (no `analyze_transaction`):

- **draft_start** → `{}`
- **token** → `{ content: string }` (streaming LLM text; not from onProgress, from `onToken`)
- **draft_done** → `{}`
- **message_end** → `{ content: string, toolsCalled: string[] }` (not from onProgress)

---

## When `analyze_transaction` is called

Order of events:

1. **draft_start** – agent started
2. *(LLM may stream tokens)*
3. **rpc_done** – `{ rawTx, receipt, tokenFlows }`
4. **etherscan_start**
5. **etherscan_done** – `{ contractABI, contractSource, internalTxs, gasContext, ... }`
6. **tenderly_start** (if Tenderly enabled)
7. **tenderly_done** – `{ trace, calls }`
8. **calltrace_enrich_start** – enriching addresses in trace
9. **calltrace_enrich_done** – `{ addressesEnriched }`
10. **calltrace_explain_start** – LLM explaining trace
11. **calltrace_explain_done** – `{ explanationLength }`
12. **draft_start** – tx analysis LLM started
13. **draft_done** – tx analysis LLM done
14. **verify_start** (if verification enabled)
15. **verify_done** – `{ passed, issuesCount }`
16. **done** – `{ report }` ← use this for tx UI
17. *(LLM may stream more tokens with summary)*
18. **draft_done** – agent finished
19. **message_end** – `{ content, toolsCalled }`

---

## Payload shapes

**rpc_done**: `rawTx` (Transaction), `receipt` (TransactionReceipt with numeric fields as strings), `tokenFlows` (array)

**etherscan_done**: `contractABI` (array or null), `contractSource` (string, truncated if >100k chars), `decodedFunction` (DecodedCall or null), `addressLabels` (Record<address, label>), `internalTxs` (raw Etherscan txlistinternal result), `gasContext` (gasPrice, baseFee or null)

**tenderly_done**: `trace` (full Tenderly debug_traceTransaction result or null), `calls` (extracted call array, empty if no trace)

**calltrace_enrich_done**: `addressesEnriched` (number of addresses enriched with labels/ABI)

**calltrace_explain_done**: `explanationLength` (length of step-by-step call trace explanation)

## `report` shape (in `done` event)

```ts
{
  summary: string;
  mevType?: string;
  steps?: any[];
  tokenFlows?: any[];
  technicalDetails?: Record<string, any>;
  verification?: { passed: boolean; issues?: string[] };
  callTraceExplanation?: string;  // step-by-step call trace explanation
}
```

BigInts are stringified in JSON.
