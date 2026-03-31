/**
 * @mainlayer/hono
 *
 * Hono middleware and utilities for Mainlayer payment infrastructure.
 * Edge-compatible: runs on Cloudflare Workers, Deno Deploy, Vercel Edge, etc.
 *
 * @example Basic paywall
 * ```ts
 * import { Hono } from 'hono'
 * import { mainlayerPaywall } from '@mainlayer/hono'
 *
 * const app = new Hono<{ Bindings: { MAINLAYER_API_KEY: string } }>()
 *
 * app.get(
 *   '/premium',
 *   mainlayerPaywall({ resourceId: 'res_123', apiKey: env.MAINLAYER_API_KEY }),
 *   (c) => c.json({ data: 'premium content' }),
 * )
 *
 * export default app
 * ```
 *
 * @example With management routes
 * ```ts
 * import { Hono } from 'hono'
 * import { createMainlayerRoutes } from '@mainlayer/hono'
 *
 * const app = new Hono()
 * app.route('/mainlayer', createMainlayerRoutes(env.MAINLAYER_API_KEY))
 * export default app
 * ```
 */

// Middleware
export { mainlayerPaywall, getMainlayerAccess } from './middleware.js'

// Router factory
export { createMainlayerRoutes } from './routes.js'

// Client
export { MainlayerClient, createClient } from './client.js'

// Types
export type {
  MainlayerPaywallOptions,
  MainlayerClientOptions,
  MainlayerRouteOptions,
  MainlayerResource,
  MainlayerAccess,
  MainlayerPayment,
  AccessCheckResponse,
  PaymentInitiateRequest,
  PaymentInitiateResponse,
  PaymentRequiredInfo,
  DiscoverResponse,
} from './types.js'

export { MainlayerError, MainlayerAuthError, MainlayerNetworkError } from './types.js'
