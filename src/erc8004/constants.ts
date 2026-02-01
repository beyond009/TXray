/**
 * ERC-8004 contract addresses (Ethereum Mainnet).
 * From https://github.com/erc-8004/erc-8004-contracts
 */
export const ERC8004_MAINNET = {
  chainId: 1,
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const,
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const,
} as const;

export const AGENT_REGISTRY_PREFIX = `eip155:${ERC8004_MAINNET.chainId}:${ERC8004_MAINNET.identityRegistry}`;
