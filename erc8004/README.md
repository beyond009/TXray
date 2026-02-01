# ERC-8004 Integration

Files for registering Mevagent on Ethereum mainnet per [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004).

## Mainnet Addresses

- Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

## Registration Flow

### 1. Register Agent

```bash
# Set in .env: RPC_URL (mainnet), PRIVATE_KEY (wallet with ETH for gas)
pnpm exec tsx scripts/erc8004-register.ts register
```

Save the output `agentId` to `.env` as `ERC8004_AGENT_ID`.

### 2. Deploy Server

Deploy your server and set `BASE_URL` in env (e.g. `https://mevagent.example.com`).

### 3. Set Agent URI

```bash
pnpm exec tsx scripts/erc8004-register.ts set-uri --agent-id <id> --base-url <https://...>
# Or with env: ERC8004_AGENT_ID, BASE_URL
```

### 4. Avatar (Optional)

Add `erc8004/mevagent-avatar.png` (recommended 512x512) for NFT/display. If missing, the registration still works.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/agent-registration.json` | Registration file (ERC-8004 compliant) |
| `GET /api/erc8004/reputation` | Reputation summary (count, average) |
| `POST /api/erc8004/feedback-tx` | Build tx for giveFeedback (frontend sends) |

## Feedback

Users give feedback by sending a transaction. The frontend should:

1. Call `POST /api/erc8004/feedback-tx` with `{ value: 85, tag1: "starred" }` (1-100 rating)
2. Send the returned `{ to, data, value }` via user's wallet

The caller must NOT be the agent owner (per spec).

## x402 Payment (Optional)

To enable pay-per-use for `/api/chat`:

1. Set `X402_PAY_TO` to your Base mainnet address (receives USDC)
2. Optionally set `X402_PRICE` (default $0.01) and `X402_NETWORK` (base | base-sepolia)
3. Clients receive HTTP 402 without payment; with `X-PAYMENT` header after paying, request succeeds

Registration file's `x402Support` is set automatically based on `X402_PAY_TO`.

**Facilitator** : Default facilitator URLs:
- base-sepolia: https://x402.org/facilitator
- base: https://pay.openfacilitator.io
Override with `X402_FACILITATOR_URL` if needed.

**Admin bypass**: Set `ADMIN_TOKEN` in env. Requests with header `X-Admin-Token: <token>` or `Authorization: Bearer <token>` skip x402 payment.
