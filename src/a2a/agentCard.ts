/**
 * Builds A2A Agent Card for discovery.
 */
export function buildAgentCard(baseUrl: string, x402Enabled = false): object {
  const base = baseUrl.replace(/\/$/, '');
  return {
    name: 'Mevagent',
    description:
      'MEV/EVM transaction analysis agent. Explains swaps, arbitrage, token flows, and contract interactions in plain language.' +
      (x402Enabled ? ' Requires x402 payment per request (USDC on Base).' : ''),
    version: '1.0.0',
    protocolVersions: ['0.3', '1.0'],
    supportedInterfaces: [
      {
        url: `${base}/a2a/v1`,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: '0.3',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      ...(x402Enabled && { x402Support: true }),
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: 'tx-analysis',
        name: 'Transaction Analysis',
        description: 'Analyze EVM transactions: swaps, arbitrage, MEV, token flows, contract calls',
        tags: ['mev', 'evm', 'transaction', 'arbitrage', 'defi'],
        examples: [
          'Analyze tx 0x...',
          'Explain how this swap makes profit',
          'What MEV pattern is in this transaction?',
        ],
      },
    ],
    iconUrl: `${base}/erc8004/mevagent-avatar.png`,
  };
}
