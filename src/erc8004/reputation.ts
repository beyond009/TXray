/**
 * ERC-8004 Reputation Registry client.
 * For giveFeedback: client (user) must sign tx; we provide encoded calldata.
 */
import { createPublicClient, encodeFunctionData, http } from 'viem';
import { mainnet } from 'viem/chains';
import { ERC8004_MAINNET } from './constants.js';
import { ReputationRegistryAbi } from './abis/ReputationRegistry.js';

const REPUTATION_REGISTRY = ERC8004_MAINNET.reputationRegistry as `0x${string}`;

export interface ReputationSummary {
  count: bigint;
  summaryValue: bigint;
  summaryValueDecimals: number;
}

export interface GiveFeedbackParams {
  agentId: number;
  value: number;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: `0x${string}`;
}

/**
 * Get reputation summary. clientAddresses is required (anti-Sybil).
 */
export async function getReputationSummary(
  agentId: number,
  clientAddresses: readonly `0x${string}`[],
  tag1 = '',
  tag2 = ''
): Promise<ReputationSummary> {
  if (clientAddresses.length === 0) {
    throw new Error('clientAddresses required (non-empty) per ERC-8004 spec');
  }
  const client = createPublicClient({
    chain: mainnet,
    transport: http(process.env.RPC_URL || process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com'),
  });
  const [count, summaryValue, summaryValueDecimals] = await client.readContract({
    address: REPUTATION_REGISTRY,
    abi: ReputationRegistryAbi,
    functionName: 'getSummary',
    args: [BigInt(agentId), [...clientAddresses] as unknown as `0x${string}`[], tag1, tag2],
  });
  return { count, summaryValue, summaryValueDecimals };
}

/**
 * Get list of client addresses that have given feedback to this agent.
 */
export async function getReputationClients(agentId: number): Promise<`0x${string}`[]> {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(process.env.RPC_URL || process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com'),
  });
  const result = await client.readContract({
    address: REPUTATION_REGISTRY,
    abi: ReputationRegistryAbi,
    functionName: 'getClients',
    args: [BigInt(agentId)],
  });
  return result.map((a) => a as `0x${string}`);
}

/**
 * Build encoded calldata for giveFeedback.
 * Frontend uses this with wallet to send tx. Caller must NOT be agent owner.
 */
export function encodeGiveFeedback(params: GiveFeedbackParams): `0x${string}` {
  const {
    agentId,
    value,
    valueDecimals = 0,
    tag1 = '',
    tag2 = '',
    endpoint = '',
    feedbackURI = '',
    feedbackHash = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
  } = params;
  if (valueDecimals < 0 || valueDecimals > 18) {
    throw new Error('valueDecimals must be 0-18');
  }
  return encodeFunctionData({
    abi: ReputationRegistryAbi,
    functionName: 'giveFeedback',
    args: [BigInt(agentId), BigInt(value), valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash],
  });
}

/**
 * Transaction params for giveFeedback (for frontend to send via wallet).
 */
export function buildGiveFeedbackTx(params: GiveFeedbackParams): {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
} {
  return {
    to: REPUTATION_REGISTRY,
    data: encodeGiveFeedback(params),
    value: 0n,
  };
}
