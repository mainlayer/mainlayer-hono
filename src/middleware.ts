/**
 * Hono middleware for Mainlayer payment gating.
 *
 * Drop this in front of any route handler to require payment before access
 * is granted. Fully edge-compatible — no Node.js APIs used.
 */

import type { Context, MiddlewareHandler } from 'hono'
import { MainlayerClient } from './client.js'
import type { MainlayerPaywallOptions, PaymentRequiredInfo } from './types.js'
import { MainlayerError } from './types.js'

const DEFAULT_BASE_URL = 'https://api.mainlayer.fr'

/**
 * Default strategy for extracting a payer identifier from the request.
 *
 * Checks (in order):
 *   1. `x-payer-wallet` request header
 *   2. `payer_wallet` query parameter
 *   3. `Authorization` header value (stripped of "Bearer " prefix)
 */
function defaultGetPayerWallet(c: Context): string | undefined {
  const header = c.req.header('x-payer-wallet')
  if (header) return header

  const query = c.req.query('payer_wallet')
  if (query) return query

  const auth = c.req.header('authorization') ?? c.req.header('Authorization')
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7)
  }

  return undefined
}

/**
 * Build the standard 402 Payment Required JSON body.
 */
function buildPaymentRequiredInfo(
  resourceId: string,
  resource: { price_usd_cents: number; price_display: string; currency: string },
  baseUrl: string,
): PaymentRequiredInfo {
  return {
    error: 'payment_required',
    resource_id: resourceId,
    price_usd_cents: resource.price_usd_cents,
    price_display: resource.price_display,
    currency: resource.currency,
    pay_endpoint: `${baseUrl}/v1/payments`,
  }
}

/**
 * Mainlayer paywall middleware for Hono.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { mainlayerPaywall } from '@mainlayer/hono'
 *
 * const app = new Hono()
 *
 * app.get(
 *   '/premium',
 *   mainlayerPaywall({ resourceId: 'res_123', apiKey: env.MAINLAYER_API_KEY }),
 *   (c) => c.json({ data: 'premium content' }),
 * )
 * ```
 */
export function mainlayerPaywall(options: MainlayerPaywallOptions): MiddlewareHandler {
  const { resourceId, apiKey, getPayerWallet, onPaymentRequired } = options
  const baseUrl = DEFAULT_BASE_URL

  if (!resourceId) throw new Error('[mainlayer] resourceId is required')
  if (!apiKey) throw new Error('[mainlayer] apiKey is required')

  const client = new MainlayerClient({ apiKey, baseUrl })

  return async (c: Context, next) => {
    // 1. Resolve payer identity
    const resolver = getPayerWallet ?? defaultGetPayerWallet
    const payerWallet = resolver(c)

    if (!payerWallet) {
      const info: PaymentRequiredInfo = {
        error: 'payment_required',
        resource_id: resourceId,
        price_usd_cents: 0,
        price_display: 'see pay_endpoint',
        currency: 'USD',
        pay_endpoint: `${baseUrl}/v1/payments`,
      }

      if (onPaymentRequired) {
        return onPaymentRequired(c, info)
      }

      return c.json(info, 402)
    }

    // 2. Check access (and fetch resource info if denied) in one call
    let result: Awaited<ReturnType<typeof client.checkAccessOrGetPaymentInfo>>

    try {
      result = await client.checkAccessOrGetPaymentInfo(resourceId, payerWallet)
    } catch (err) {
      if (err instanceof MainlayerError) {
        // Surface Mainlayer API errors with context but don't leak internals
        return c.json(
          {
            error: 'mainlayer_error',
            code: err.code,
            message: err.message,
          },
          err.statusCode as 400 | 401 | 402 | 403 | 404 | 429 | 500 | 503,
        )
      }
      // Unknown error — fail closed
      return c.json({ error: 'internal_error', message: 'Payment check failed' }, 500)
    }

    // 3. Grant or deny
    if (result.granted) {
      // Expose access metadata downstream via context variables
      c.set('mainlayer_access', result.access)
      c.set('mainlayer_payer_wallet', payerWallet)
      await next()
      return
    }

    // 4. Build and return 402
    const info = buildPaymentRequiredInfo(resourceId, result.resource, baseUrl)

    if (onPaymentRequired) {
      return onPaymentRequired(c, info)
    }

    return c.json(info, 402)
  }
}

/**
 * Retrieve Mainlayer access metadata set by the paywall middleware.
 * Must be called inside a handler that sits behind `mainlayerPaywall`.
 */
export function getMainlayerAccess(c: Context) {
  return {
    access: c.get('mainlayer_access') as ReturnType<typeof c.get> | undefined,
    payerWallet: c.get('mainlayer_payer_wallet') as string | undefined,
  }
}
