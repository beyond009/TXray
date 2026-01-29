import { StateGraph, Annotation } from '@langchain/langgraph';
import { extractNode, draftNode, outputNode } from './nodes.js';

export function createMEVAnalyzer() {
  const StateAnnotation = Annotation.Root({
    txHash: Annotation<string>,
    chain: Annotation<string>,
    rawTx: Annotation<any>,
    decodedCalls: Annotation<any[]>,
    tokenFlows: Annotation<any[]>,
    draftExplanation: Annotation<string>,
    finalReport: Annotation<any>,
    error: Annotation<string>,
  });

  const workflow = new StateGraph(StateAnnotation);

  workflow.addNode('extract', extractNode as any);
  workflow.addNode('draft', draftNode as any);
  workflow.addNode('output', outputNode as any);

  (workflow as any).addEdge('__start__', 'extract');
  (workflow as any).addEdge('extract', 'draft');
  (workflow as any).addEdge('draft', 'output');
  (workflow as any).addEdge('output', '__end__');

  return workflow.compile();
}

export async function analyzeTx(txHash: string, chain: string = 'ethereum') {
  const analyzer = createMEVAnalyzer();
  
  const result = await analyzer.invoke({
    txHash,
    chain,
  });
  
  return result;
}
