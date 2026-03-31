/**
 * Edge API example: subscription-tier gating with Mainlayer.
 *
 * Demonstrates:
 *   - Multiple subscription tiers (free / pro / enterprise)
 *   - Middleware chaining with per-route resource IDs
 *   - Custom payer resolution from a JWT claim (decoded inline)
 *   - Graceful error responses for AI agent consumers
 *
 * Works on Cloudflare Workers, Deno Deploy, and any WinterCG runtime.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMainlayerRoutes, getMainlayerAccess, mainlayerPaywall } from '@mainlayer/hono'
import type { PaymentRequiredInfo } from '@mainlayer/hono'

// ─── Environment ──────────────────────────────────────────────────────────────

type Env = {
  MAINLAYER_API_KEY: string
}

// ─── Subscription tiers → Mainlayer resource IDs ──────────────────────────────

const TIERS = {
  PRO: 'res_subscription_pro',
  ENTERPRISE: 'res_subscription_enterprise',
  API_CALL: 'res_api_call_single',
} as const

// ─── Utility: decode JWT payload (no verification — demo only) ───────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payloadB64] = token.split('.')
    const padded = payloadB64.padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), '=')
    const decoded = atob(padded)
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Extract the caller's wallet from a Bearer JWT's `wallet` claim,
 * falling back to the `x-payer-wallet` header.
 */
function getPayerWallet(c: import('hono').Context): string | undefined {
  const auth = c.req.header('authorization') ?? ''
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7)
    const payload = decodeJwtPayload(token)
    if (payload?.wallet && typeof payload.wallet === 'string') {
      return payload.wallet
    }
  }
  return c.req.header('x-payer-wallet')
}

// ─── Shared 402 handler ───────────────────────────────────────────────────────

function agentFriendly402(c: import('hono').Context, info: PaymentRequiredInfo) {
  return c.json(
    {
      error: info.error,
      resource_id: info.resource_id,
      price_usd_cents: info.price_usd_cents,
      price_display: info.price_display,
      currency: info.currency,
      pay_endpoint: info.pay_endpoint,
      // Machine-readable action guide for AI agents
      action: {
        method: 'POST',
        url: info.pay_endpoint,
        body: {
          resource_id: info.resource_id,
          payer_wallet: '<your-wallet-id>',
        },
        description: `Pay ${info.price_display} to unlock this resource.`,
      },
    },
    402,
  )
}

// ─── Middleware factories ─────────────────────────────────────────────────────

function requireProSubscription(apiKey: string) {
  return mainlayerPaywall({
    resourceId: TIERS.PRO,
    apiKey,
    getPayerWallet,
    onPaymentRequired: agentFriendly402,
  })
}

function requireEnterpriseSubscription(apiKey: string) {
  return mainlayerPaywall({
    resourceId: TIERS.ENTERPRISE,
    apiKey,
    getPayerWallet,
    onPaymentRequired: agentFriendly402,
  })
}

function requireApiCallPayment(apiKey: string) {
  return mainlayerPaywall({
    resourceId: TIERS.API_CALL,
    apiKey,
    getPayerWallet,
    onPaymentRequired: agentFriendly402,
  })
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

// ─── Mainlayer routes (discovery + payments) ──────────────────────────────────

app.use('/mainlayer/*', async (c, next) => {
  const router = createMainlayerRoutes(c.env.MAINLAYER_API_KEY)
  const stripped = new Request(c.req.url.replace('/mainlayer', ''), c.req.raw)
  const res = await router.fetch(stripped)
  if (res.status !== 404) return res
  await next()
})

// ─── Free tier ────────────────────────────────────────────────────────────────

app.get('/api/free/status', (c) =>
  c.json({
    tier: 'free',
    message: 'This endpoint is free. Upgrade to Pro for more.',
    upgrade_url: `${new URL(c.req.url).origin}/mainlayer/discover`,
  }),
)

// ─── Pro subscription tier ────────────────────────────────────────────────────

app.get(
  '/api/pro/models',
  async (c, next) => requireProSubscription(c.env.MAINLAYER_API_KEY)(c, next),
  (c) => {
    const { payerWallet } = getMainlayerAccess(c)
    return c.json({
      tier: 'pro',
      payer: payerWallet,
      models: [
        { id: 'ml-fast-v1', context_window: 32_000, capabilities: ['text', 'code'] },
        { id: 'ml-balanced-v2', context_window: 128_000, capabilities: ['text', 'code', 'vision'] },
      ],
    })
  },
)

app.post(
  '/api/pro/generate',
  async (c, next) => requireProSubscription(c.env.MAINLAYER_API_KEY)(c, next),
  async (c) => {
    const { payerWallet } = getMainlayerAccess(c)
    let body: { prompt?: string; model?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      // allow missing body
    }

    return c.json({
      tier: 'pro',
      payer: payerWallet,
      model: body.model ?? 'ml-fast-v1',
      prompt: body.prompt ?? '',
      completion: `[Pro completion for: "${body.prompt ?? ''}"]`,
      tokens: { prompt: 12, completion: 48, total: 60 },
    })
  },
)

// ─── Enterprise subscription tier ────────────────────────────────────────────

app.post(
  '/api/enterprise/batch',
  async (c, next) => requireEnterpriseSubscription(c.env.MAINLAYER_API_KEY)(c, next),
  async (c) => {
    const { payerWallet } = getMainlayerAccess(c)
    let body: { prompts?: string[] } = {}
    try {
      body = await c.req.json()
    } catch {
      // allow missing body
    }

    const prompts = body.prompts ?? ['default prompt']
    return c.json({
      tier: 'enterprise',
      payer: payerWallet,
      batch_id: `batch_${Date.now()}`,
      total: prompts.length,
      results: prompts.map((p, i) => ({
        index: i,
        prompt: p,
        completion: `[Enterprise batch result for: "${p}"]`,
      })),
    })
  },
)

// ─── Pay-per-call endpoint ────────────────────────────────────────────────────

app.post(
  '/api/pay-per-call/analyze',
  async (c, next) => requireApiCallPayment(c.env.MAINLAYER_API_KEY)(c, next),
  async (c) => {
    const { payerWallet } = getMainlayerAccess(c)
    let body: { text?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      // allow missing body
    }

    return c.json({
      tier: 'pay-per-call',
      payer: payerWallet,
      text: body.text ?? '',
      analysis: {
        sentiment: 'positive',
        confidence: 0.94,
        topics: ['AI', 'payments', 'infrastructure'],
        word_count: (body.text ?? '').split(' ').length,
      },
    })
  },
)

// ─── Export ───────────────────────────────────────────────────────────────────

export default app
