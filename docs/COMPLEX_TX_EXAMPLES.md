# Complex Transaction Examples

Use these tx hashes to stress-test the analyzer (multi-hop swaps, MEV, aggregators, many internal calls).

| Tx Hash | Description | Complexity |
|--------|-------------|------------|
| `0x2a615005a63785284f11a4c5cb803d1935d34e358c10a3b4d76398d2e7bb2f9d` | **EigenPhi MEV** – Compound withdraw (1.29M USDC), Uniswap V3 WETH↔USDC, Uniswap V3 USDC↔USDT, Curve (USDT swap, 3pool, tricrypto). MEV bot, 18+ token transfers, 150+ internal txns. | Very high |
| `0x63883758850d124689c4756e19c9f5bc40622c4394393565c313e5be6e3cf181` | **Uniswap Universal Router** – ETH→WETH swap via Universal Router, Uniswap V3 PUNK 8 pool. Internal txns, multiple token transfers. | High |
| `0x4ac9808c04dcb6c26de1ba6cc15c419d76dfad2625a0bc91a0c108c045175d08` | **1inch aggregation** – 1inch → WETH via AggregationRouterV3, Uniswap V2. | Medium |
| `0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060` | **Internal calls** – Used in `test:etherscan`; multiple internal contract calls. | Medium |
| `0x5e1b1de8504bed6fc94e5cd87be7a42b28efe75fae7214b51ca57a5340b3826b` | **WETH swap** – Simple DEX swap (WETH in/out), good baseline. | Low–medium |

## Quick test

```bash
pnpm exec tsx src/cli.ts 0x2a615005a63785284f11a4c5cb803d1935d34e358c10a3b4d76398d2e7bb2f9d
```

## Sources

- [EigenPhi tx tool](https://tx.eigenphi.io/) – paste tx hash to visualize.
- [Etherscan](https://etherscan.io/) – tx details, internal txns, token transfers.
