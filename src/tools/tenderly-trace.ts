import { type Hash } from 'viem';
import { tenderlyClient } from './tenderly.js';
import type { TenderlySimulationResult, CallTrace } from './tenderly.js';

/**
 * 获取历史交易的执行轨迹（使用 debug_traceTransaction）
 * 这是获取已执行交易真实轨迹的正确方法
 * 
 * @param txHash 交易哈希
 * @returns 交易轨迹和状态
 */
export async function traceHistoricalTransaction(
  txHash: string
): Promise<TenderlySimulationResult | null> {
  if (!tenderlyClient) {
    console.log('   ⚠️  Tenderly RPC not configured');
    return null;
  }

  try {
    console.log(`   🔍 [Tenderly] Tracing historical transaction ${txHash.slice(0, 10)}...`);
    console.log(`      Method: debug_traceTransaction (actual execution trace)`);
    
    // 获取交易 receipt 以获取实际 gas 和状态
    const receipt = await tenderlyClient.getTransactionReceipt({ hash: txHash as Hash });
    
    // 使用 debug_traceTransaction 获取实际执行轨迹
    const traceResult = await tenderlyClient.request({
      method: 'debug_traceTransaction' as any,
      params: [
        txHash,
        { tracer: 'callTracer' } // 使用 callTracer 获取调用轨迹
      ] as any,
    });

    console.log(`   ✅ [Tenderly] Trace obtained successfully!`);
    console.log(`      Actual Gas Used: ${receipt.gasUsed}`);
    console.log(`      Status: ${receipt.status === 'success' ? '✅ Success' : '❌ Failed'}`);
    
    // 转换为统一格式
    const trace = traceResult as any;
    
    // 递归转换 trace
    const convertTrace = (t: any): CallTrace => {
      return {
        type: t.type || 'CALL',
        from: t.from,
        to: t.to,
        value: t.value,
        gas: t.gas,
        gasUsed: t.gasUsed,
        input: t.input,
        output: t.output,
        error: t.error,
        calls: t.calls ? t.calls.map(convertTrace) : undefined,
      };
    };
    
    const result: any = {
      gasUsed: `0x${receipt.gasUsed.toString(16)}`,
      status: receipt.status === 'success',
      trace: [convertTrace(trace)], // 包装成数组以匹配类型
      logs: receipt.logs.map(log => ({
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    };
    
    // 递归计算所有调用
    const countCalls = (t: CallTrace): number => {
      let count = 1;
      if (t.calls) {
        for (const call of t.calls) {
          count += countCalls(call);
        }
      }
      return count;
    };
    
    const totalCalls = result.trace[0] ? countCalls(result.trace[0]) : 0;
    console.log(`      Total Calls: ${totalCalls}`);
    console.log(`      Logs: ${result.logs?.length || 0}`);

    return result;
  } catch (error) {
    console.error('   ❌ [Tenderly] Trace failed:', error);
    console.error('      This may indicate:');
    console.error('      - Tenderly Node doesn\'t support debug_traceTransaction');
    console.error('      - Transaction is too old (archive data not available)');
    console.error('      - Network connectivity issues');
    return null;
  }
}

/**
 * 递归提取所有调用
 */
export function extractAllCallsFromTrace(call: CallTrace, calls: CallTrace[] = []): CallTrace[] {
  calls.push(call);
  if (call.calls) {
    for (const subcall of call.calls) {
      extractAllCallsFromTrace(subcall, calls);
    }
  }
  return calls;
}
