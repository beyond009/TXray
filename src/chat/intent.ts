/**
 * Rule-based intent detection for chat.
 * When the user message contains a tx hash (0x + 64 hex), treat as analyze_tx.
 */

const TX_HASH_REGEX = /0x[a-fA-F0-9]{64}\b/g;

export type IntentType = 'analyze_tx' | 'chat';

export interface Intent {
  type: IntentType;
  payload?: { txHash: string };
}

export function detectIntent(message: string): Intent {
  const trimmed = message.trim();
  const match = trimmed.match(TX_HASH_REGEX);
  if (match && match.length > 0) {
    return {
      type: 'analyze_tx',
      payload: { txHash: match[0] },
    };
  }
  return { type: 'chat' };
}
