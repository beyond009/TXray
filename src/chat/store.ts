/**
 * SQLite-based conversation store for persistent chat history.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.CHAT_DB_PATH || path.join(__dirname, '../../data/chat.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
  
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
`);

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
}

function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const stmtGetConversation = db.prepare('SELECT id FROM conversations WHERE id = ?');
const stmtCreateConversation = db.prepare('INSERT INTO conversations (id) VALUES (?)');
const stmtGetMessages = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC');
const stmtInsertMessage = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)');
const stmtUpdateConversation = db.prepare('UPDATE conversations SET updated_at = strftime(\'%s\', \'now\') WHERE id = ?');

export function getOrCreateConversation(conversationId?: string): Conversation {
  const id = conversationId || generateId();
  
  const existing = stmtGetConversation.get(id) as { id: string } | undefined;
  
  if (existing) {
    const messages = stmtGetMessages.all(id) as ChatMessage[];
    return { id, messages };
  }
  
  stmtCreateConversation.run(id);
  return { id, messages: [] };
}

export function appendMessage(conversationId: string, role: 'user' | 'assistant', content: string): void {
  stmtInsertMessage.run(conversationId, role, content);
  stmtUpdateConversation.run(conversationId);
}

export function getConversation(conversationId: string): Conversation | null {
  const existing = stmtGetConversation.get(conversationId) as { id: string } | undefined;
  if (!existing) return null;
  
  const messages = stmtGetMessages.all(conversationId) as ChatMessage[];
  return { id: conversationId, messages };
}

export function deleteConversation(conversationId: string): boolean {
  const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  return result.changes > 0;
}

export function listConversations(limit = 50): Array<{ id: string; messageCount: number; updatedAt: number }> {
  return db.prepare(`
    SELECT c.id, COUNT(m.id) as messageCount, c.updated_at as updatedAt
    FROM conversations c
    LEFT JOIN messages m ON c.id = m.conversation_id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string; messageCount: number; updatedAt: number }>;
}

export function cleanupOldConversations(maxAgeDays = 30): number {
  const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 24 * 60 * 60);
  const result = db.prepare('DELETE FROM conversations WHERE updated_at < ?').run(cutoff);
  return result.changes;
}

// Database instance available internally
// Use exported functions for all operations
