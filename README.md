# @mainlayer/hono

Hono middleware for [Mainlayer](https://mainlayer.xyz) — payment infrastructure for AI agents. Gate any route behind a paywall in two lines. Fully edge-compatible: runs on **Cloudflare Workers**, Deno Deploy, Vercel Edge Functions, and any [WinterCG](https://wintercg.org/) runtime.

[![npm version](https://img.shields.io/npm/v/@mainlayer/hono)](https://www.npmjs.com/package/@mainlayer/hono)
[![CI](https://github.com/mainlayer/mainlayer-js/actions/workflows/ci.yml/badge.svg)](https://github.com/mainlayer/mainlayer-js/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **`mainlayerPaywall`** — drop-in Hono middleware; returns `402 Payment Required` with machine-readable payment info when access is not yet purchased
- **`createMainlayerRoutes`** — Hono router factory that mounts discovery, payment, and access-check endpoints for AI agent auto-discovery
- **`MainlayerClient`** — thin, edge-compatible API client built on native `fetch` (zero Node.js dependencies)
- Full TypeScript types
- Customisable payer-identity resolution (header, query param, JWT, or your own logic)
- Custom `onPaymentRequired` callback for bespoke 402 responses

---

## Install

```bash
npm install @mainlayer/hono hono
# or
pnpm add @mainlayer/hono hono
# or
yarn add @mainlayer/hono hono
```

> **Peer dependency**: `hono >= 3.0.0`

---

## Quickstart — Cloudflare Workers

```typescript
// src/index.ts
import { Hono } from 'hono'
import { mainlayerPaywall, createMainlayerRoutes } from '@mainlayer/hono'

type Env = { MAINLAYER_API_KEY: string }

const app = new Hono<{ Bindings: Env }>()

// 1. Mount Mainlayer management routes (discovery + payments + access checks)
app.use('/mainlayer/*', async (c, next) => {
  const router = createMainlayerRoutes(c.env.MAINLAYER_API_KEY)
  const stripped = new Request(c.req.url.replace('/mainlayer', ''), c.req.raw)
  const res = await router.fetch(stripped)
  if (res.status !== 404) return res
  await next()
})

// 2. Gate any route with a single middleware call
app.get(
  '/api/premium',
  async (c, next) =>
    mainlayerPaywall({
      resourceId: 'res_premium_123',
      apiKey: c.env.MAINLAYER_API_KEY,
    })(c, next),
  (c) => c.json({ data: 'you paid for this' }),
)

export default app
```

Set your API key with Wrangler:

```bash
npx wrangler secret put MAINLAYER_API_KEY
```

Deploy:

```bash
npx wrangler deploy
```

---

## API Reference

### `mainlayerPaywall(options)`

Hono middleware that checks access before forwarding to the next handler.

```typescript
import { mainlayerPaywall } from '@mainlayer/hono'

mainlayerPaywall({
  resourceId: 'res_abc123',       // required — the Mainlayer resource to gate
  apiKey: 'ml_live_...',          // required — your Mainlayer API key
  getPayerWallet: (c) => ...,     // optional — custom payer resolution
  onPaymentRequired: (c, info) => // optional — custom 402 response
    c.json({ ...info, hint: 'see docs' }, 402),
})
```

**Default payer resolution** (checked in order):

1. `x-payer-wallet` request header
2. `payer_wallet` query parameter
3. `Authorization: Bearer <token>` — strips `Bearer ` prefix

**When access is denied** the middleware returns:

```json
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": "payment_required",
  "resource_id": "res_abc123",
  "price_usd_cents": 100,
  "price_display": "$1.00",
  "currency": "USD",
  "pay_endpoint": "https://api.mainlayer.xyz/v1/payments"
}
```

**When access is granted**, the middleware sets two context variables downstream handlers can read:

```typescript
import { getMainlayerAccess } from '@mainlayer/hono'

app.get('/premium', mainlayerPaywall({ ... }), (c) => {
  const { access, payerWallet } = getMainlayerAccess(c)
  return c.json({ payer: payerWallet, expires: access?.expires_at })
})
```

---

### `createMainlayerRoutes(apiKey, options?)`

Returns a Hono app (router) pre-wired with three Mainlayer routes. Mount it on your app with `app.route(prefix, createMainlayerRoutes(key))`.

```typescript
import { createMainlayerRoutes } from '@mainlayer/hono'

app.route('/mainlayer', createMainlayerRoutes(apiKey))
```

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mainlayer/discover` | API capabilities and available resources. AI agents call this first. |
| `POST` | `/mainlayer/pay` | Initiate a payment. Body: `{ resource_id, payer_wallet }` |
| `GET` | `/mainlayer/access/:resourceId` | Check access. Query: `?payer_wallet=<wallet>` |

**`GET /mainlayer/discover` response example:**

```json
{
  "api_version": "v1",
  "integration": "@mainlayer/hono",
  "base_url": "https://api.mainlayer.xyz",
  "pay_endpoint": "https://api.mainlayer.xyz/v1/payments",
  "access_endpoint": "https://api.mainlayer.xyz/v1/access/:resourceId",
  "supported_currencies": ["USD"],
  "available_resources": [
    {
      "id": "res_premium_123",
      "name": "Premium Inference",
      "price_usd_cents": 100,
      "price_display": "$1.00",
      "currency": "USD"
    }
  ]
}
```

---

### `MainlayerClient`

A low-level, edge-compatible API client. Use it directly when you need finer control.

```typescript
import { MainlayerClient } from '@mainlayer/hono'

const client = new MainlayerClient({
  apiKey: 'ml_live_...',
  baseUrl: 'https://api.mainlayer.xyz', // optional, this is the default
  timeoutMs: 10_000,                    // optional, default 10s
})

// Check access
const access = await client.checkAccess('res_abc123', 'payer_wallet_xyz')
if (access.granted) {
  // proceed
}

// Get resource metadata
const resource = await client.getResource('res_abc123')
console.log(resource.price_display) // "$1.00"

// Initiate a payment
const payment = await client.initiatePayment({
  resource_id: 'res_abc123',
  payer_wallet: 'payer_wallet_xyz',
})
console.log(payment.status) // "pending"

// List all resources
const resources = await client.listResources()
```

---

## Custom Payer Resolution

Extract the payer identifier from anywhere in the request:

```typescript
mainlayerPaywall({
  resourceId: 'res_abc',
  apiKey: env.MAINLAYER_API_KEY,
  getPayerWallet: (c) => {
    // e.g. from a cookie
    return c.req.header('cookie')
      ?.split(';')
      .find(s => s.trim().startsWith('wallet='))
      ?.split('=')[1]
  },
})
```

---

## Subscription Tiers

Gate different routes with different resource IDs to implement subscription tiers:

```typescript
const free   = (c, next) => next() // no paywall
const pro    = (c, next) => mainlayerPaywall({ resourceId: 'res_pro', apiKey })(c, next)
const enterprise = (c, next) => mainlayerPaywall({ resourceId: 'res_enterprise', apiKey })(c, next)

app.get('/api/free/data',       free, freeHandler)
app.get('/api/pro/models',      pro, proHandler)
app.post('/api/enterprise/batch', enterprise, enterpriseHandler)
```

---

## Error Handling

All errors thrown by `MainlayerClient` extend `MainlayerError`:

```typescript
import { MainlayerError, MainlayerAuthError, MainlayerNetworkError } from '@mainlayer/hono'

try {
  await client.checkAccess(resourceId, payerWallet)
} catch (err) {
  if (err instanceof MainlayerAuthError) {
    // invalid API key
  } else if (err instanceof MainlayerNetworkError) {
    // fetch failed or timed out
  } else if (err instanceof MainlayerError) {
    console.log(err.statusCode, err.code, err.details)
  }
}
```

The middleware handles these automatically: `MainlayerAuthError` → `401`, `MainlayerNetworkError` → `503`, other `MainlayerError` → their `statusCode`, unknown errors → `500`.

---

## Deployment

### Cloudflare Workers

```bash
# 1. Install Wrangler
npm install -g wrangler

# 2. Set your API key (stored as a secret, never in wrangler.toml)
npx wrangler secret put MAINLAYER_API_KEY

# 3. Deploy
npx wrangler deploy
```

See [`examples/cloudflare-worker.ts`](examples/cloudflare-worker.ts) for a complete example.

### Vercel Edge Functions

```typescript
// api/route.ts (Next.js 13+ App Router)
export const runtime = 'edge'

import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { mainlayerPaywall } from '@mainlayer/hono'

const app = new Hono().basePath('/api')
app.get('/premium', mainlayerPaywall({ resourceId: 'res_abc', apiKey: process.env.MAINLAYER_API_KEY! }), handler)

export const GET = handle(app)
```

### Deno Deploy

```typescript
import { Hono } from 'npm:hono'
import { mainlayerPaywall } from 'npm:@mainlayer/hono'

const app = new Hono()
app.get('/premium', mainlayerPaywall({ resourceId: 'res_abc', apiKey: Deno.env.get('MAINLAYER_API_KEY')! }), handler)

Deno.serve(app.fetch)
```

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type-check
npm run typecheck

# Build
npm run build
```

---

## License

MIT — see [LICENSE](LICENSE).

---

## Support

- Documentation: [https://docs.mainlayer.xyz](https://docs.mainlayer.xyz)
- Issues: [https://github.com/mainlayer/mainlayer-js/issues](https://github.com/mainlayer/mainlayer-js/issues)
