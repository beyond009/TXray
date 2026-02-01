# A2A (Agent-to-Agent) Integration

Mevagent supports the [Agent2Agent (A2A) Protocol](https://a2a-protocol.org/) for agent-to-agent communication. Other AI agents can discover and call Mevagent via standard A2A endpoints.

## Discovery

**Agent Card** (well-known):
```
GET /.well-known/agent-card.json
```

Returns Mevagent's capabilities, skills, and interface URLs.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/a2a/v1/message:send` | Send message, get Task (blocking or non-blocking) |
| POST | `/a2a/v1/message:stream` | Send message, receive SSE stream of Task + updates |
| GET | `/a2a/v1/tasks/{id}` | Get task status and artifacts |

## Request Format

**POST /a2a/v1/message:send**
```json
{
  "message": {
    "messageId": "msg-uuid",
    "role": "ROLE_USER",
    "parts": [{ "text": "Analyze tx 0x123..." }]
  },
  "configuration": {
    "blocking": true
  }
}
```

- `message.contextId` – Optional. Reuse for multi-turn (same conversation).
- `configuration.blocking` – If `true` (default), wait for completion. If `false`, return task immediately and process in background.

## Response Format

**Success (200):**
```json
{
  "task": {
    "id": "task-uuid",
    "contextId": "conv_xxx",
    "status": { "state": "TASK_STATE_COMPLETED" },
    "artifacts": [{
      "artifactId": "artifact-uuid",
      "name": "Analysis",
      "parts": [{ "text": "..." }]
    }]
  }
}
```

## Streaming (POST /a2a/v1/message:stream)

Returns `text/event-stream`:
1. Initial `task` with `TASK_STATE_WORKING`
2. `artifactUpdate` with analysis result
3. `statusUpdate` with `TASK_STATE_COMPLETED`

## Client Example (cURL)

```bash
# Get Agent Card
curl https://your-server.com/.well-known/agent-card.json

# Send message (blocking)
curl -X POST https://your-server.com/a2a/v1/message:send \
  -H "Content-Type: application/json" \
  -d '{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"Analyze tx 0x..."}]}}'

# Get task
curl https://your-server.com/a2a/v1/tasks/{taskId}
```

## Payment (x402)

When `X402_PAY_TO` is set, both `message:send` and `message:stream` require x402 payment (same price as `/api/chat`). Use `X-Admin-Token` or `Authorization: Bearer <ADMIN_TOKEN>` to bypass. `GET /tasks/:id` is free (read-only status).

## Notes
- Multi-turn: include `contextId` from a previous task in follow-up messages.
- Compatible with A2A protocol versions 0.3 and 1.0.
