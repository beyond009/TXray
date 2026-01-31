/**
 * LangGraph-based chat agent with tool calling.
 * Uses ReAct pattern: the LLM decides when to call tools.
 */
import { StateGraph, Annotation, messagesStateReducer } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { config, llmConfig } from '../config/index.js';
import { createTools, type ToolProgressCallback } from './tools.js';

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

function createLLM() {
  if (llmConfig.provider === 'openrouter') {
    return new ChatOpenAI({
      apiKey: config.anthropicApiKey,
      model: llmConfig.model,
      temperature: 0,
      configuration: { baseURL: llmConfig.baseURL },
    });
  }
  return new ChatAnthropic({
    apiKey: config.anthropicApiKey,
    model: llmConfig.model,
    temperature: 0,
  });
}

function shouldContinue(state: typeof AgentState.State): 'tools' | '__end__' {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage && 'tool_calls' in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }
  return '__end__';
}

export interface ChatAgentOptions {
  onProgress?: ToolProgressCallback;
  onToken?: (token: string) => void;
}

const SYSTEM_PROMPT = `You are a friendly Ethereum blockchain analyst assistant. You help users understand transactions, addresses, and smart contracts.

Available tools:
- analyze_transaction: Analyze a transaction hash (0x + 64 hex chars) to explain token transfers, MEV activity, etc.
- analyze_address: Analyze an address (coming soon)

Guidelines:
- Have natural conversations with users - remember context from earlier in the chat
- When given a transaction hash, use analyze_transaction immediately
- Be concise but helpful
- Respond in the user's language`;

export function createChatAgent(options?: ChatAgentOptions) {
  const tools = createTools(options?.onProgress);
  const llm = createLLM().bindTools(tools);
  const toolNode = new ToolNode(tools);

  async function callModel(state: typeof AgentState.State) {
    const messagesWithSystem = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...state.messages,
    ];
    const response = await llm.invoke(messagesWithSystem);
    return { messages: [response] };
  }

  const workflow = new StateGraph(AgentState)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addEdge('__start__', 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .addEdge('tools', 'agent');

  return workflow.compile();
}

export interface ChatResult {
  response: string;
  toolsCalled: string[];
}

export async function chat(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: ChatAgentOptions
): Promise<ChatResult> {
  const agent = createChatAgent(options);

  // Filter out empty messages from history
  const validMessages = messages.filter(m => m.content && m.content.trim());
  
  const langchainMessages = validMessages.map((m) =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  console.log(`[Chat] Processing ${langchainMessages.length} messages in history`);

  options?.onProgress?.({ type: 'draft_start' });

  const toolsCalled: string[] = [];
  let finalResponse = '';
  let hasStreamedContent = false;

  try {
    // Use streamEvents for proper streaming with tool calling
    const eventStream = agent.streamEvents(
      { messages: langchainMessages },
      { version: 'v2' }
    );

    for await (const event of eventStream) {
      // Stream tokens from LLM response (captures ALL LLM generations including post-tool calls)
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        const content = event.data.chunk.content;
        if (typeof content === 'string' && content) {
          options?.onToken?.(content);
          finalResponse += content;
          hasStreamedContent = true;
        }
      }

      // Track tool calls
      if (event.event === 'on_tool_start') {
        const toolName = event.name;
        if (toolName && !toolsCalled.includes(toolName)) {
          toolsCalled.push(toolName);
          console.log(`[Chat] Tool called: ${toolName}`);
        }
      }

      // Fallback: capture final state if streaming somehow missed content
      if (event.event === 'on_chain_end' && event.name === 'LangGraph') {
        const output = event.data?.output;
        if (output?.messages && Array.isArray(output.messages)) {
          const lastMsg = output.messages[output.messages.length - 1];
          if (lastMsg?.content && typeof lastMsg.content === 'string' && !hasStreamedContent) {
            // Only use final message if streaming failed
            finalResponse = lastMsg.content;
          }
        }
      }
    }
  } catch (err) {
    console.error('[Chat] Stream error:', err);
    throw err;
  }

  options?.onProgress?.({ type: 'draft_done' });

  console.log(`[Chat] Response length: ${finalResponse.length}, tools: ${toolsCalled.join(', ') || 'none'}`);

  return { response: finalResponse, toolsCalled };
}
