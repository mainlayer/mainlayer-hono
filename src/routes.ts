/**
 * Hono router factory for Mainlayer management endpoints.
 *
 * Mounts three routes under a configurable prefix:
 *   GET  {prefix}/discover            — API capabilities + endpoint directory
 *   POST {prefix}/pay                 — Initiate a payment for a resource
 *   GET  {prefix}/access/:resourceId  — Check access for a payer
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { createMainlayerRoutes } from '@mainlayer/hono'
 *
 * const app = new Hono()
 * app.route('/mainlayer', createMainlayerRoutes(env.MAINLAYER_API_KEY))
 * ```
 */

import { Hono } from 'hono'
import { MainlayerClient } from './client.js'
import type { MainlayerRouteOptions, PaymentInitiateRequest } from './types.js'
import { MainlayerError } from './types.js'

const DEFAULT_BASE_URL = 'https://api.mainlayer.xyz'

function handleError(c: import('hono').Context, err: unknown) {
  if (err instanceof MainlayerError) {
    return c.json(
      { error: err.code, message: err.message, details: err.details },
      err.statusCode as 400 | 401 | 402 | 403 | 404 | 429 | 500 | 503,
    )
  }
  const message = err instanceof Error ? err.message : 'An unexpected error occurred'
  return c.json({ error: 'internal_error', message }, 500)
}

/**
 * Create a Hono app (router) pre-wired with Mainlayer routes.
 *
 * Mount it on your main app with `app.route(prefix, createMainlayerRoutes(key))`.
 */
export function createMainlayerRoutes(
  apiKey: string,
  options: MainlayerRouteOptions = {},
): Hono {
  if (!apiKey) throw new Error('[mainlayer] apiKey is required')

  const baseUrl = DEFAULT_BASE_URL
  const client = new MainlayerClient({ apiKey, baseUrl })
  const router = new Hono()

  // ─── GET /discover ──────────────────────────────────────────────────────────
  /**
   * Returns a machine-readable directory of the Mainlayer API endpoints and
   * capabilities supported by this integration. AI agents can use this to
   * auto-discover how to pay for resources.
   */
  router.get('/discover', async (c) => {
    try {
      const resources = await client.listResources()

      return c.json({
        api_version: 'v1',
        integration: '@mainlayer/hono',
        base_url: baseUrl,
        endpoints: {
          discover: `${baseUrl}/v1/resources`,
          pay: `${baseUrl}/v1/payments`,
          access: `${baseUrl}/v1/access/:resourceId`,
        },
        resources_endpoint: `${baseUrl}/v1/resources`,
        pay_endpoint: `${baseUrl}/v1/payments`,
        access_endpoint: `${baseUrl}/v1/access/:resourceId`,
        supported_currencies: ['USD'],
        available_resources: resources.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          price_usd_cents: r.price_usd_cents,
          price_display: r.price_display,
          currency: r.currency,
        })),
      })
    } catch (err) {
      return handleError(c, err)
    }
  })

  // ─── POST /pay ──────────────────────────────────────────────────────────────
  /**
   * Initiate a payment for a resource.
   *
   * Body: { resource_id: string, payer_wallet: string }
   */
  router.post('/pay', async (c) => {
    let body: Partial<PaymentInitiateRequest>

    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid_request', message: 'Request body must be valid JSON' }, 400)
    }

    if (!body.resource_id || typeof body.resource_id !== 'string') {
      return c.json(
        { error: 'invalid_request', message: 'resource_id is required and must be a string' },
        400,
      )
    }

    if (!body.payer_wallet || typeof body.payer_wallet !== 'string') {
      return c.json(
        { error: 'invalid_request', message: 'payer_wallet is required and must be a string' },
        400,
      )
    }

    try {
      const payment = await client.initiatePayment({
        resource_id: body.resource_id,
        payer_wallet: body.payer_wallet,
      })

      return c.json(payment, 201)
    } catch (err) {
      return handleError(c, err)
    }
  })

  // ─── GET /access/:resourceId ─────────────────────────────────────────────────
  /**
   * Check whether a payer has access to a specific resource.
   *
   * Query: ?payer_wallet=<wallet>
   */
  router.get('/access/:resourceId', async (c) => {
    const resourceId = c.req.param('resourceId')
    const payerWallet = c.req.query('payer_wallet')

    if (!payerWallet) {
      return c.json(
        { error: 'invalid_request', message: 'payer_wallet query parameter is required' },
        400,
      )
    }

    try {
      const access = await client.checkAccess(resourceId, payerWallet)
      return c.json(access)
    } catch (err) {
      return handleError(c, err)
    }
  })

  return router
}
