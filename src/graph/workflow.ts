import type { ProgressEvent } from '../types/index.js';
import { runWithProgress } from '../chat/progress.js';
import { StateGraph, Annotation } from '@langchain/langgraph';
import { extractNode, draftNode, verifyNode, outputNode } from './nodes.js';

export function createMEVAnalyzer() {
  const StateAnnotation = Annotation.Root({
    txHash: Annotation<string>,
    chain: Annotation<string>,
    rawTx: Annotation<any>,
    decodedCalls: Annotation<any[]>,
    tokenFlows: Annotation<any[]>,
    draftExplanation: Annotation<string>,
    verificationResult: Annotation<any>,
    finalReport: Annotation<any>,
    error: Annotation<string>,
  });

  const workflow = new StateGraph(StateAnnotation);

  workflow.addNode('extract', extractNode as any);
  workflow.addNode('draft', draftNode as any);
  workflow.addNode('verify', verifyNode as any);
  workflow.addNode('output', outputNode as any);

  (workflow as any).addEdge('__start__', 'extract');
  (workflow as any).addEdge('extract', 'draft');
  (workflow as any).addEdge('draft', 'verify');
  (workflow as any).addEdge('verify', 'output');
  (workflow as any).addEdge('output', '__end__');

  return workflow.compile();
}

export interface AnalyzeTxOptions {
  onProgress?: (event: ProgressEvent) => void;
}

export async function analyzeTx(txHash: string, chain: string = 'ethereum', options?: AnalyzeTxOptions) {
  const analyzer = createMEVAnalyzer();
  const invoke = () => analyzer.invoke({ txHash, chain });

  if (options?.onProgress) {
    return runWithProgress(options.onProgress, invoke);
  }
  return invoke();
}
