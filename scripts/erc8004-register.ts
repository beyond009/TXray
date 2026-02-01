#!/usr/bin/env node
/**
 * ERC-8004 Registration Script
 *
 * Phase 1: Register agent on Ethereum mainnet Identity Registry.
 * Phase 2: Set agent URI (run after deploying server).
 *
 * Usage:
 *   pnpm exec tsx scripts/erc8004-register.ts register
 *   pnpm exec tsx scripts/erc8004-register.ts set-uri --agent-id <id> --base-url <https://...>
 *
 * Env: RPC_URL (mainnet), PRIVATE_KEY (wallet with ETH for gas)
 */
import 'dotenv/config';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { ERC8004_MAINNET } from '../src/erc8004/constants.js';
import { IdentityRegistryAbi } from '../src/erc8004/abis/IdentityRegistry.js';

const IDENTITY_REGISTRY = ERC8004_MAINNET.identityRegistry as `0x${string}`;
const RPC = process.env.RPC_URL || process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com';

function getAccount() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk?.startsWith('0x')) throw new Error('PRIVATE_KEY required (0x-prefixed hex)');
  return privateKeyToAccount(pk as `0x${string}`);
}

async function phaseRegister(): Promise<number> {
  const account = getAccount();
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(RPC),
  });

  console.log('Registering agent on ERC-8004 Identity Registry (mainnet)...');
  const hash = await client.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IdentityRegistryAbi,
    functionName: 'register',
    args: [],
  });
  console.log('Tx hash:', hash);

  const publicClient = createPublicClient({ chain: mainnet, transport: http(RPC) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const log = receipt.logs.find((l) => l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && l.topics[0]);
  if (!log?.topics[1]) throw new Error('Registered event not found');
  const agentId = Number(BigInt(log.topics[1]));
  console.log('\nAgent registered!');
  console.log('agentId:', agentId);
  console.log('\nAdd to .env:');
  console.log(`ERC8004_AGENT_ID=${agentId}`);
  return agentId;
}

function buildRegistrationFile(agentId: number, baseUrl: string): string {
  return JSON.stringify(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'Mevagent',
      description:
        'MEV/EVM transaction analysis agent. Explains swaps, arbitrage, token flows, and contract interactions in plain language.',
      image: `${baseUrl.replace(/\/$/, '')}/erc8004/mevagent-avatar.png`,
      services: [
        {
          name: 'web',
          endpoint: `${baseUrl.replace(/\/$/, '')}/api/chat`,
        },
      ],
      x402Support: false,
      active: true,
      registrations: [
        {
          agentId,
          agentRegistry: `eip155:1:${IDENTITY_REGISTRY}`,
        },
      ],
      supportedTrust: ['reputation'],
    },
    null,
    2
  );
}

async function phaseSetUri(agentId: number, baseUrl: string): Promise<void> {
  const account = getAccount();
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(RPC),
  });

  const registrationUrl = `${baseUrl.replace(/\/$/, '')}/.well-known/agent-registration.json`;
  console.log('Setting agent URI to:', registrationUrl);

  const hash = await client.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IdentityRegistryAbi,
    functionName: 'setAgentURI',
    args: [BigInt(agentId), registrationUrl],
  });
  console.log('Tx hash:', hash);
  console.log('\nDone. Ensure your server serves the registration file at that URL.');
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'register') {
    await phaseRegister();
    return;
  }

  if (cmd === 'set-uri') {
    const agentIdx = args.indexOf('--agent-id');
    const urlIdx = args.indexOf('--base-url');
    const agentId = agentIdx >= 0 ? parseInt(args[agentIdx + 1], 10) : parseInt(process.env.ERC8004_AGENT_ID || '0', 10);
    const baseUrl = urlIdx >= 0 ? args[urlIdx + 1] : process.env.BASE_URL;
    if (!agentId || !baseUrl) {
      console.error('Usage: set-uri --agent-id <id> --base-url <https://your-domain.com>');
      console.error('Or set ERC8004_AGENT_ID and BASE_URL in .env');
      process.exit(1);
    }
    await phaseSetUri(agentId, baseUrl);
    return;
  }

  if (cmd === 'print-registration') {
    const agentId = parseInt(process.env.ERC8004_AGENT_ID || '0', 10);
    const baseUrl = process.env.BASE_URL || 'https://YOUR_DEPLOYED_URL';
    if (!agentId) {
      console.error('Set ERC8004_AGENT_ID in .env');
      process.exit(1);
    }
    console.log(buildRegistrationFile(agentId, baseUrl));
    return;
  }

  console.log(`
ERC-8004 Registration

Commands:
  register              Mint new agent, get agentId
  set-uri               Set agent URI (after server deploy)
  print-registration    Print registration JSON (for hosting)

Examples:
  pnpm exec tsx scripts/erc8004-register.ts register
  pnpm exec tsx scripts/erc8004-register.ts set-uri --agent-id 1 --base-url https://mevagent.example.com
  pnpm exec tsx scripts/erc8004-register.ts print-registration

Env: RPC_URL, PRIVATE_KEY (required for register/set-uri)
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
