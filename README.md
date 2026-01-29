# Transaction Analysis Agent (EVM)

A TypeScript + LangGraph project that fetches on-chain transaction data (RPC / Tenderly / Etherscan) and generates a natural-language explanation using an LLM.

## Setup

```bash
pnpm install
cp .env.example .env
```

Minimum required in `.env`:

```bash
# LLM
LLM_PROVIDER=openrouter   # or: anthropic
OPENROUTER_API_KEY=...    # or: ANTHROPIC_API_KEY=...
LLM_MODEL=anthropic/claude-3.5-sonnet

# RPC
ETHEREUM_RPC_URL=https://eth.llamarpc.com
CHAIN_ID=1
```

Optional (recommended):

```bash
# Better traces (historical debug_traceTransaction via Tenderly RPC)
TENDERLY_RPC_URL=https://mainnet.gateway.tenderly.co/YOUR_KEY
USE_TENDERLY_SIMULATION=true

# Contract ABI / source (when available)
ETHERSCAN_API_KEY=YOUR_KEY
```

If you need a proxy, run via:

```bash
./run-with-proxy.sh pnpm exec tsx src/cli.ts 0xYOUR_TX_HASH
```

## Run

```bash
pnpm exec tsx src/cli.ts 0xYOUR_TX_HASH
```

## License

MIT (see `LICENSE`).
