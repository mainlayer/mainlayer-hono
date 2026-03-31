/**
 * Tests for @mainlayer/hono middleware, routes, and client.
 *
 * Uses Hono's testClient helper and Vitest. All Mainlayer API calls are
 * intercepted with vi.spyOn on the MainlayerClient prototype methods so
 * no real HTTP requests are made.
 */

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MainlayerClient } from '../src/client.js'
import { getMainlayerAccess, mainlayerPaywall } from '../src/middleware.js'
import { createMainlayerRoutes } from '../src/routes.js'
import { MainlayerAuthError, MainlayerError, MainlayerNetworkError } from '../src/types.js'
import type {
  AccessCheckResponse,
  MainlayerResource,
  PaymentInitiateResponse,
} from '../src/types.js'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const RESOURCE_ID = 'res_test_123'
const API_KEY = 'ml_test_key_abc'
const PAYER_WALLET = 'payer_wallet_xyz'

const mockResource: MainlayerResource = {
  id: RESOURCE_ID,
  name: 'Premium Endpoint',
  description: 'Access to premium AI inference',
  price_usd_cents: 100,
  price_display: '$1.00',
  currency: 'USD',
  active: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const mockAccessGranted: AccessCheckResponse = {
  resource_id: RESOURCE_ID,
  payer_wallet: PAYER_WALLET,
  granted: true,
  expires_at: '2025-12-31T23:59:59Z',
  granted_at: '2025-01-01T00:00:00Z',
}

const mockAccessDenied: AccessCheckResponse = {
  resource_id: RESOURCE_ID,
  payer_wallet: PAYER_WALLET,
  granted: false,
}

const mockPaymentResponse: PaymentInitiateResponse = {
  payment_id: 'pay_abc_123',
  resource_id: RESOURCE_ID,
  payer_wallet: PAYER_WALLET,
  amount_usd_cents: 100,
  currency: 'USD',
  status: 'pending',
  pay_url: 'https://pay.mainlayer.fr/pay_abc_123',
}

// ─── Helper: build a minimal Hono test app ────────────────────────────────────

function buildPaywallApp(overrides: Partial<Parameters<typeof mainlayerPaywall>[0]> = {}) {
  const app = new Hono()

  app.get(
    '/protected',
    mainlayerPaywall({ resourceId: RESOURCE_ID, apiKey: API_KEY, ...overrides }),
    (c) => {
      const { payerWallet } = getMainlayerAccess(c)
      return c.json({ message: 'access granted', payer: payerWallet })
    },
  )

  return app
}

async function callApp(
  app: Hono,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const method = opts.method ?? 'GET'
  const req = new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const res = await app.fetch(req)
  const body = await res.json()
  return { status: res.status, body }
}

// ─── Tests: mainlayerPaywall middleware ───────────────────────────────────────

describe('mainlayerPaywall middleware', () => {
  let checkAccessOrGetPaymentInfo: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.restoreAllMocks()
    checkAccessOrGetPaymentInfo = vi.spyOn(
      MainlayerClient.prototype,
      'checkAccessOrGetPaymentInfo',
    )
  })

  it('returns 402 when no payer wallet is provided', async () => {
    // No wallet header, no query param, no Auth header
    const app = buildPaywallApp()
    const { status, body } = await callApp(app, '/protected')

    expect(status).toBe(402)
    expect((body as Record<string, string>).error).toBe('payment_required')
    expect((body as Record<string, string>).resource_id).toBe(RESOURCE_ID)
    expect(checkAccessOrGetPaymentInfo).not.toHaveBeenCalled()
  })

  it('returns 402 with payment info when access is denied', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: false,
      resource: mockResource,
      access: mockAccessDenied,
    })

    const app = buildPaywallApp()
    const { status, body } = await callApp(app, '/protected', {
      headers: { 'x-payer-wallet': PAYER_WALLET },
    })

    expect(status).toBe(402)
    const json = body as Record<string, unknown>
    expect(json.error).toBe('payment_required')
    expect(json.resource_id).toBe(RESOURCE_ID)
    expect(json.price_usd_cents).toBe(100)
    expect(json.price_display).toBe('$1.00')
    expect(json.currency).toBe('USD')
    expect(typeof json.pay_endpoint).toBe('string')
  })

  it('calls next() and returns 200 when access is granted', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: true,
      access: mockAccessGranted,
    })

    const app = buildPaywallApp()
    const { status, body } = await callApp(app, '/protected', {
      headers: { 'x-payer-wallet': PAYER_WALLET },
    })

    expect(status).toBe(200)
    expect((body as Record<string, string>).message).toBe('access granted')
    expect((body as Record<string, string>).payer).toBe(PAYER_WALLET)
  })

  it('resolves payer wallet from x-payer-wallet header', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: true,
      access: mockAccessGranted,
    })

    const app = buildPaywallApp()
    await callApp(app, '/protected', { headers: { 'x-payer-wallet': PAYER_WALLET } })

    expect(checkAccessOrGetPaymentInfo).toHaveBeenCalledWith(RESOURCE_ID, PAYER_WALLET)
  })

  it('resolves payer wallet from query parameter', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: true,
      access: mockAccessGranted,
    })

    const app = buildPaywallApp()
    await callApp(app, `/protected?payer_wallet=${encodeURIComponent(PAYER_WALLET)}`)

    expect(checkAccessOrGetPaymentInfo).toHaveBeenCalledWith(RESOURCE_ID, PAYER_WALLET)
  })

  it('resolves payer wallet from Authorization Bearer header', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: true,
      access: mockAccessGranted,
    })

    const app = buildPaywallApp()
    await callApp(app, '/protected', {
      headers: { Authorization: `Bearer ${PAYER_WALLET}` },
    })

    expect(checkAccessOrGetPaymentInfo).toHaveBeenCalledWith(RESOURCE_ID, PAYER_WALLET)
  })

  it('uses custom getPayerWallet when provided', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: true,
      access: mockAccessGranted,
    })

    const customWallet = 'custom_wallet_id'
    const app = buildPaywallApp({
      getPayerWallet: () => customWallet,
    })

    await callApp(app, '/protected')

    expect(checkAccessOrGetPaymentInfo).toHaveBeenCalledWith(RESOURCE_ID, customWallet)
  })

  it('returns 402 when custom getPayerWallet returns undefined', async () => {
    const app = buildPaywallApp({ getPayerWallet: () => undefined })
    const { status } = await callApp(app, '/protected')
    expect(status).toBe(402)
  })

  it('invokes onPaymentRequired callback when provided and access is denied', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: false,
      resource: mockResource,
      access: mockAccessDenied,
    })

    const app = buildPaywallApp({
      onPaymentRequired: (c, info) =>
        c.json({ custom: true, resource_id: info.resource_id }, 402),
    })

    const { status, body } = await callApp(app, '/protected', {
      headers: { 'x-payer-wallet': PAYER_WALLET },
    })

    expect(status).toBe(402)
    expect((body as Record<string, unknown>).custom).toBe(true)
  })

  it('invokes onPaymentRequired when no payer wallet is found', async () => {
    const app = buildPaywallApp({
      onPaymentRequired: (c, info) =>
        c.json({ custom_402: true, resource_id: info.resource_id }, 402),
    })

    const { status, body } = await callApp(app, '/protected')

    expect(status).toBe(402)
    expect((body as Record<string, unknown>).custom_402).toBe(true)
  })

  it('returns 401 when Mainlayer returns an auth error', async () => {
    checkAccessOrGetPaymentInfo.mockRejectedValue(new MainlayerAuthError())

    const app = buildPaywallApp()
    const { status, body } = await callApp(app, '/protected', {
      headers: { 'x-payer-wallet': PAYER_WALLET },
    })

    expect(status).toBe(401)
    expect((body as Record<string, string>).code).toBe('auth_error')
  })

  it('returns 503 when a network error occurs', async () => {
    checkAccessOrGetPaymentInfo.mockRejectedValue(
      new MainlayerNetworkError('timeout'),
    )

    const app = buildPaywallApp()
    const { status } = await callApp(app, '/protected', {
      headers: { 'x-payer-wallet': PAYER_WALLET },
    })

    expect(status).toBe(503)
  })

  it('returns 500 on unknown errors', async () => {
    checkAccessOrGetPaymentInfo.mockRejectedValue(new Error('unexpected'))

    const app = buildPaywallApp()
    const { status, body } = await callApp(app, '/protected', {
      headers: { 'x-payer-wallet': PAYER_WALLET },
    })

    expect(status).toBe(500)
    expect((body as Record<string, string>).error).toBe('internal_error')
  })

  it('sets mainlayer context variables on access granted', async () => {
    checkAccessOrGetPaymentInfo.mockResolvedValue({
      granted: true,
      access: mockAccessGranted,
    })

    const app = new Hono()
    app.get(
      '/protected',
      mainlayerPaywall({ resourceId: RESOURCE_ID, apiKey: API_KEY }),
      (c) => {
        const { access, payerWallet } = getMainlayerAccess(c)
        return c.json({ access, payerWallet })
      },
    )

    const { status, body } = await callApp(app, '/protected', {
      headers: { 'x-payer-wallet': PAYER_WALLET },
    })

    expect(status).toBe(200)
    const json = body as Record<string, unknown>
    expect((json.access as AccessCheckResponse).granted).toBe(true)
    expect(json.payerWallet).toBe(PAYER_WALLET)
  })

  it('throws at middleware creation when resourceId is missing', () => {
    expect(() =>
      mainlayerPaywall({ resourceId: '', apiKey: API_KEY }),
    ).toThrow('[mainlayer] resourceId is required')
  })

  it('throws at middleware creation when apiKey is missing', () => {
    expect(() =>
      mainlayerPaywall({ resourceId: RESOURCE_ID, apiKey: '' }),
    ).toThrow('[mainlayer] apiKey is required')
  })
})

// ─── Tests: createMainlayerRoutes ─────────────────────────────────────────────

describe('createMainlayerRoutes', () => {
  let getResource: ReturnType<typeof vi.spyOn>
  let listResources: ReturnType<typeof vi.spyOn>
  let checkAccess: ReturnType<typeof vi.spyOn>
  let initiatePayment: ReturnType<typeof vi.spyOn>

  function buildRouterApp() {
    const app = new Hono()
    app.route('/mainlayer', createMainlayerRoutes(API_KEY))
    return app
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    getResource = vi.spyOn(MainlayerClient.prototype, 'getResource')
    listResources = vi.spyOn(MainlayerClient.prototype, 'listResources')
    checkAccess = vi.spyOn(MainlayerClient.prototype, 'checkAccess')
    initiatePayment = vi.spyOn(MainlayerClient.prototype, 'initiatePayment')
  })

  // GET /mainlayer/discover
  it('GET /discover returns API info and resource list', async () => {
    listResources.mockResolvedValue([mockResource])

    const app = buildRouterApp()
    const { status, body } = await callApp(app, '/mainlayer/discover')

    expect(status).toBe(200)
    const json = body as Record<string, unknown>
    expect(json.api_version).toBe('v1')
    expect(json.integration).toBe('@mainlayer/hono')
    expect(Array.isArray(json.available_resources)).toBe(true)
    expect((json.available_resources as unknown[])).toHaveLength(1)
    expect(typeof json.pay_endpoint).toBe('string')
    expect(typeof json.access_endpoint).toBe('string')
  })

  it('GET /discover returns 500 when listResources fails', async () => {
    listResources.mockRejectedValue(new Error('API down'))

    const app = buildRouterApp()
    const { status } = await callApp(app, '/mainlayer/discover')
    expect(status).toBe(500)
  })

  // POST /mainlayer/pay
  it('POST /pay initiates payment and returns 201', async () => {
    initiatePayment.mockResolvedValue(mockPaymentResponse)

    const app = buildRouterApp()
    const { status, body } = await callApp(app, '/mainlayer/pay', {
      method: 'POST',
      body: { resource_id: RESOURCE_ID, payer_wallet: PAYER_WALLET },
    })

    expect(status).toBe(201)
    const json = body as typeof mockPaymentResponse
    expect(json.payment_id).toBe('pay_abc_123')
    expect(json.status).toBe('pending')
  })

  it('POST /pay returns 400 when resource_id is missing', async () => {
    const app = buildRouterApp()
    const { status, body } = await callApp(app, '/mainlayer/pay', {
      method: 'POST',
      body: { payer_wallet: PAYER_WALLET },
    })

    expect(status).toBe(400)
    expect((body as Record<string, string>).error).toBe('invalid_request')
  })

  it('POST /pay returns 400 when payer_wallet is missing', async () => {
    const app = buildRouterApp()
    const { status, body } = await callApp(app, '/mainlayer/pay', {
      method: 'POST',
      body: { resource_id: RESOURCE_ID },
    })

    expect(status).toBe(400)
    expect((body as Record<string, string>).error).toBe('invalid_request')
  })

  it('POST /pay returns 400 when body is not valid JSON', async () => {
    const app = buildRouterApp()
    const req = new Request('http://localhost/mainlayer/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(400)
  })

  it('POST /pay propagates MainlayerError status codes', async () => {
    initiatePayment.mockRejectedValue(
      new MainlayerError('Resource not found', 404, 'not_found'),
    )

    const app = buildRouterApp()
    const { status, body } = await callApp(app, '/mainlayer/pay', {
      method: 'POST',
      body: { resource_id: RESOURCE_ID, payer_wallet: PAYER_WALLET },
    })

    expect(status).toBe(404)
    expect((body as Record<string, string>).error).toBe('not_found')
  })

  // GET /mainlayer/access/:resourceId
  it('GET /access/:resourceId returns access info when granted', async () => {
    checkAccess.mockResolvedValue(mockAccessGranted)

    const app = buildRouterApp()
    const { status, body } = await callApp(
      app,
      `/mainlayer/access/${RESOURCE_ID}?payer_wallet=${PAYER_WALLET}`,
    )

    expect(status).toBe(200)
    const json = body as AccessCheckResponse
    expect(json.granted).toBe(true)
    expect(json.resource_id).toBe(RESOURCE_ID)
  })

  it('GET /access/:resourceId returns access denied when not granted', async () => {
    checkAccess.mockResolvedValue(mockAccessDenied)

    const app = buildRouterApp()
    const { status, body } = await callApp(
      app,
      `/mainlayer/access/${RESOURCE_ID}?payer_wallet=${PAYER_WALLET}`,
    )

    expect(status).toBe(200)
    expect((body as AccessCheckResponse).granted).toBe(false)
  })

  it('GET /access/:resourceId returns 400 when payer_wallet is missing', async () => {
    const app = buildRouterApp()
    const { status, body } = await callApp(app, `/mainlayer/access/${RESOURCE_ID}`)

    expect(status).toBe(400)
    expect((body as Record<string, string>).error).toBe('invalid_request')
  })

  it('GET /access/:resourceId propagates auth errors', async () => {
    checkAccess.mockRejectedValue(new MainlayerAuthError())

    const app = buildRouterApp()
    const { status } = await callApp(
      app,
      `/mainlayer/access/${RESOURCE_ID}?payer_wallet=${PAYER_WALLET}`,
    )

    expect(status).toBe(401)
  })

  it('throws when apiKey is empty', () => {
    expect(() => createMainlayerRoutes('')).toThrow('[mainlayer] apiKey is required')
  })

  it('router is composable — mounted routes work at non-root prefix', async () => {
    listResources.mockResolvedValue([])

    const app = new Hono()
    app.route('/api/v1/ml', createMainlayerRoutes(API_KEY))

    const { status } = await callApp(app, '/api/v1/ml/discover')
    expect(status).toBe(200)
  })
})
