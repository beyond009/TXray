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

const SYSTEM_PROMPT = `You are an Ethereum blockchain analyst assistant. You help users understand transactions, addresses, and smart contracts.

Your capabilities:
- analyze_transaction: Analyze a transaction hash to explain what happened (token transfers, MEV activity, etc.)
- analyze_address: Analyze an address to understand its activity (coming soon)

Guidelines:
- When a user provides a transaction hash (0x followed by 64 hex characters), use analyze_transaction tool immediately
- When a user asks about an address, inform them that address analysis is coming soon
- Be concise but thorough in your explanations
- If analysis fails, explain the error clearly
- You can have a normal conversation when users have general questions

Always respond in the same language the user uses.`;

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

  const langchainMessages = messages.map((m) =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  options?.onProgress?.({ type: 'draft_start' });

  const toolsCalled: string[] = [];

  // Use streamEvents for proper streaming with tool calling
  const eventStream = agent.streamEvents(
    { messages: langchainMessages },
    { version: 'v2' }
  );

  let finalResponse = '';

  for await (const event of eventStream) {
    // Stream tokens from final LLM response
    if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
      const content = event.data.chunk.content;
      if (typeof content === 'string' && content) {
        options?.onToken?.(content);
        finalResponse += content;
      }
    }

    // Track tool calls
    if (event.event === 'on_tool_start') {
      const toolName = event.name;
      if (toolName && !toolsCalled.includes(toolName)) {
        toolsCalled.push(toolName);
      }
    }

    // Emit progress events from tools
    if (event.event === 'on_tool_end' && event.data?.output) {
      // Tool completed
    }
  }

  options?.onProgress?.({ type: 'draft_done' });

  return { response: finalResponse, toolsCalled };
}
