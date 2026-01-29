/**
 * In-memory conversation store for chat.
 * Keys: conversationId, value: { messages: { role, content }[] }.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
}

const conversations = new Map<string, Conversation>();

function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getOrCreateConversation(conversationId?: string): Conversation {
  if (conversationId) {
    const existing = conversations.get(conversationId);
    if (existing) return existing;
  }
  const id = conversationId || generateId();
  const conv: Conversation = { id, messages: [] };
  conversations.set(id, conv);
  return conv;
}

export function appendMessage(conversationId: string, role: 'user' | 'assistant', content: string): void {
  const conv = conversations.get(conversationId);
  if (conv) {
    conv.messages.push({ role, content });
  }
}
