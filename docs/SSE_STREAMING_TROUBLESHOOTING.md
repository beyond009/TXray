# SSE Streaming Troubleshooting

## Symptom: Request stays "pending" then completes all at once (especially with x402 payment)

This indicates response buffering: the server produces events but they are held until the end.

## Root cause (x402): middleware buffers until settle()

**x402-express** wraps `res.write`, `res.end`, and `res.flushHeaders` to **buffer all output** until payment is settled with the facilitator. Only after `res.end()` and `settle()` complete does it replay the buffered writes. This breaks SSE streaming by design.

**Fix applied**: We use a custom `createStreamingPaymentGate` (`src/x402-streaming-gate.ts`) that runs **verify + settle before** calling `next()`, so the handler streams directly with no buffering.

### Server-side changes (already applied)

- `res.flush?.()` after each SSE write to force flush when compression middleware provides it
- `res.socket?.setNoDelay(true)` to disable Nagle and send small chunks immediately
- `Cache-Control: no-cache, no-transform` to hint proxies not to buffer/transform
- `X-Accel-Buffering: no` for nginx

### Things to check

1. **Reverse proxy buffering**  
   If deployed behind nginx, Caddy, or similar, ensure buffering is disabled for the SSE path:
   - nginx: `proxy_buffering off` for `/api/chat`
   - Or rely on `X-Accel-Buffering: no` if nginx is configured to respect it

2. **Compression**  
   Do not enable gzip/compression for `text/event-stream`. Compression buffers the response and breaks SSE. If using `compression` middleware, add a filter:
   ```js
   app.use(compression({
     filter: (req, res) => res.getHeader('Content-Type') !== 'text/event-stream'
   }));
   ```

3. **Platform (Railway, Vercel, etc.)**  
   Some platforms buffer by default. Check platform docs for disabling response buffering on streaming routes.

4. **Frontend: streaming vs buffering**  
   Use streaming consumption of the response, not a single await on the full body:
   - **Correct**: `EventSource` or `fetch` with `response.body.getReader()` / `ReadableStream`
   - **Incorrect**: `response.json()`, `response.text()`, or awaiting the whole response

   Example with fetch:
   ```js
   const res = await fetch('/api/chat', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'X-PAYMENT': '...' },
     body: JSON.stringify({ message: '...' })
   });
   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   while (true) {
     const { done, value } = await reader.read();
     if (done) break;
     // Parse SSE from decoder.decode(value)
   }
   ```

5. **Payment flow**  
   If the paid request goes through a facilitator proxy (frontend → facilitator → your backend), the facilitator may buffer the response. Sending `X-PAYMENT` directly to your backend avoids this.

### Isolate the cause

1. **Test with admin token** (bypass x402): If streaming works with `X-Admin-Token` but not with `X-PAYMENT`, the payment middleware or payment flow may be involved.
2. **Test locally** vs deployed: If it works locally but not on Railway, the platform proxy is likely buffering.
3. Use `curl` to confirm events arrive incrementally:
   ```bash
   curl -N -X POST http://localhost:3000/api/chat \
     -H "Content-Type: application/json" \
     -H "X-Admin-Token: YOUR_TOKEN" \
     -d '{"message":"0xYOUR_TX_HASH"}' 
   ```
2. With x402: send a valid `X-PAYMENT` header and compare behavior.
3. If streaming works without payment (e.g. with admin token) but not with payment, the difference is likely in the payment path (proxy, frontend handling, or headers).
