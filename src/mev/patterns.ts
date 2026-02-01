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
  
  const hasProfit = Array.from(netFlows.values()).some(net => net > 0n);
  
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

export function detectSandwich(
  _tx: Transaction,
  tokenFlows: TokenFlow[]
): MEVPattern | null {
  const largeSwap = tokenFlows.length >= 2 && 
    tokenFlows.some(f => BigInt(f.amount) > 10n ** 20n);
  
  if (largeSwap) {
    return {
      type: 'sandwich',
      confidence: 0.3,
      details: {
        note: 'Potential large swap (needs context of surrounding txs)',
        flowCount: tokenFlows.length,
      },
    };
  }
  
  return null;
}

export function identifyMEVPattern(
  tx: Transaction,
  tokenFlows: TokenFlow[]
): MEVPattern {
  const patterns = [
    detectArbitrage(tx, tokenFlows),
    detectSandwich(tx, tokenFlows),
  ];
  
  const detected = patterns.filter(p => p !== null) as MEVPattern[];
  
  if (detected.length === 0) {
    return {
      type: 'unknown',
      confidence: 1.0,
      details: {},
    };
  }
  
  detected.sort((a, b) => b.confidence - a.confidence);
  return detected[0];
}
