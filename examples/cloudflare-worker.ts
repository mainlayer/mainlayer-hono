/**
 * Complete Cloudflare Worker example using Mainlayer payment gating.
 *
 * Deploy with:
 *   npx wrangler deploy
 *
 * Set your API key:
 *   npx wrangler secret put MAINLAYER_API_KEY
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { createMainlayerRoutes, mainlayerPaywall } from '@mainlayer/hono'
import type { PaymentRequiredInfo } from '@mainlayer/hono'

// ─── Cloudflare Worker environment bindings ───────────────────────────────────

type Env = {
  MAINLAYER_API_KEY: string
  /** Optional: KV namespace for caching access checks */
  ACCESS_CACHE?: KVNamespace
}

// ─── App setup ────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use('*', cors())

// ─── Public routes ────────────────────────────────────────────────────────────

app.get('/', (c) =>
  c.json({
    name: 'Mainlayer AI API',
    version: '1.0.0',
    description: 'Pay-per-use AI inference powered by Mainlayer',
    endpoints: {
      public: ['GET /'],
      discovery: ['GET /mainlayer/discover'],
      payment: ['POST /mainlayer/pay'],
      access: ['GET /mainlayer/access/:resourceId'],
      premium: [
        'GET /api/inference/fast',
        'POST /api/inference/advanced',
        'GET /api/data/premium',
      ],
    },
  }),
)

// ─── Mainlayer management routes ─────────────────────────────────────────────

app.use('/mainlayer/*', async (c, next) => {
  // Mount Mainlayer discovery/payment/access routes
  const router = createMainlayerRoutes(c.env.MAINLAYER_API_KEY)
  // Strip the /mainlayer prefix so inner routes resolve correctly
  const stripped = new Request(
    c.req.url.replace('/mainlayer', ''),
    c.req.raw,
  )
  const res = await router.fetch(stripped)
  if (res.status !== 404) return res
  await next()
})

// ─── Custom 402 handler factory ───────────────────────────────────────────────

function custom402(c: import('hono').Context, info: PaymentRequiredInfo) {
  return c.json(
    {
      ...info,
      // Add a human-readable hint for AI agents
      instructions:
        `To gain access, POST to ${info.pay_endpoint} with ` +
        `{ "resource_id": "${info.resource_id}", "payer_wallet": "<your-wallet>" }`,
      docs: 'https://docs.mainlayer.fr/agents',
    },
    402,
  )
}

// ─── Gated: fast inference (per-request billing) ──────────────────────────────

app.get(
  '/api/inference/fast',
  async (c, next) => {
    const mw = mainlayerPaywall({
      resourceId: 'res_inference_fast',
      apiKey: c.env.MAINLAYER_API_KEY,
      onPaymentRequired: custom402,
    })
    return mw(c, next)
  },
  async (c) => {
    const prompt = c.req.query('prompt') ?? 'Hello!'

    // Simulate AI inference response
    return c.json({
      model: 'mainlayer-fast-v1',
      prompt,
      completion: `[Fast inference result for: "${prompt}"]`,
      tokens_used: 42,
      latency_ms: 120,
    })
  },
)

// ─── Gated: advanced inference (per-request billing) ─────────────────────────

app.post(
  '/api/inference/advanced',
  async (c, next) => {
    const mw = mainlayerPaywall({
      resourceId: 'res_inference_advanced',
      apiKey: c.env.MAINLAYER_API_KEY,
      onPaymentRequired: custom402,
    })
    return mw(c, next)
  },
  async (c) => {
    let body: { prompt?: string; max_tokens?: number } = {}
    try {
      body = await c.req.json()
    } catch {
      // allow empty body
    }

    const prompt = body.prompt ?? 'Explain quantum computing'
    const maxTokens = body.max_tokens ?? 500

    return c.json({
      model: 'mainlayer-advanced-v2',
      prompt,
      completion: `[Advanced inference result for: "${prompt}" (max_tokens: ${maxTokens})]`,
      tokens_used: 387,
      latency_ms: 1450,
    })
  },
)

// ─── Gated: premium data endpoint ────────────────────────────────────────────

app.get(
  '/api/data/premium',
  async (c, next) => {
    const mw = mainlayerPaywall({
      resourceId: 'res_data_premium',
      apiKey: c.env.MAINLAYER_API_KEY,
      // Custom payer resolution: accept from header OR cookie
      getPayerWallet: (ctx) =>
        ctx.req.header('x-payer-wallet') ??
        ctx.req.header('x-agent-id') ??
        undefined,
      onPaymentRequired: custom402,
    })
    return mw(c, next)
  },
  (c) =>
    c.json({
      dataset: 'premium-market-data-v3',
      records: 10_000,
      last_updated: new Date().toISOString(),
      data: [
        { symbol: 'AI', value: 42.0, change: '+1.5%' },
        { symbol: 'ML', value: 87.3, change: '-0.2%' },
      ],
    }),
)

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
)

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ error: 'not_found', path: c.req.path }, 404),
)

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'internal_error', message: 'An unexpected error occurred' }, 500)
})

// ─── Export for Cloudflare Workers ───────────────────────────────────────────

export default app
