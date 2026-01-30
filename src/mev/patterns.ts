import type { Transaction, TokenFlow, MEVPattern } from '../types/index.js';

export function detectArbitrage(
  tx: Transaction,
  tokenFlows: TokenFlow[]
): MEVPattern | null {
  const fromAddress = tx.from.toLowerCase();
  
  const netFlows = new Map<string, bigint>();
  
  for (const flow of tokenFlows) {
    const token = flow.token.toLowerCase();
    const amount = BigInt(flow.amount);
    
    if (flow.to.toLowerCase() === fromAddress) {
      netFlows.set(token, (netFlows.get(token) || 0n) + amount);
    }
    if (flow.from.toLowerCase() === fromAddress) {
      netFlows.set(token, (netFlows.get(token) || 0n) - amount);
    }
  }
  
  // 检查是否有代币净增加 (可能是利润)
  const hasProfit = Array.from(netFlows.values()).some(net => net > 0n);
  
  // 检查是否涉及多个代币 (套利通常在多个池子间进行)
  const uniqueTokens = new Set(tokenFlows.map(f => f.token.toLowerCase())).size;
  
  if (hasProfit && uniqueTokens >= 2) {
    return {
      type: 'arbitrage',
      confidence: 0.7,
      details: {
        uniqueTokens,
        netFlows: Object.fromEntries(
          Array.from(netFlows.entries()).map(([k, v]) => [k, v.toString()])
        ),
      },
    };
  }
  
  return null;
}

/**
 * 检测三明治攻击
 * 启发式: 需要访问前后交易，MVP 暂时简化
 * TODO: 在完整版本中实现区块内交易分析
 */
export function detectSandwich(
  _tx: Transaction,
  tokenFlows: TokenFlow[]
): MEVPattern | null {
  // MVP: 简单标记为未知
  // 完整实现需要: 获取同区块的前后交易，分析价格影响
  
  // 占位实现: 检测是否为大额 swap (可能是被夹击的目标)
  const largeSwap = tokenFlows.length >= 2 && 
    tokenFlows.some(f => BigInt(f.amount) > 10n ** 20n); // > 100 tokens (假设 18 decimals)
  
  if (largeSwap) {
    return {
      type: 'sandwich',
      confidence: 0.3, // 低置信度，因为无法确认
      details: {
        note: 'Potential large swap (needs context of surrounding txs)',
        flowCount: tokenFlows.length,
      },
    };
  }
  
  return null;
}

/**
 * 主识别函数: 尝试所有模式
 */
export function identifyMEVPattern(
  tx: Transaction,
  tokenFlows: TokenFlow[]
): MEVPattern {
  // 按优先级尝试各种模式
  const patterns = [
    detectArbitrage(tx, tokenFlows),
    detectSandwich(tx, tokenFlows),
  ];
  
  // 返回最高置信度的模式
  const detected = patterns.filter(p => p !== null) as MEVPattern[];
  
  if (detected.length === 0) {
    return {
      type: 'unknown',
      confidence: 1.0,
      details: {},
    };
  }
  
  // 返回置信度最高的
  detected.sort((a, b) => b.confidence - a.confidence);
  return detected[0];
}
