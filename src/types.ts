/**
 * TypeScript types for @mainlayer/hono
 */

// ─── Core resource/pricing types ─────────────────────────────────────────────

export interface MainlayerResource {
  id: string
  name: string
  description?: string
  /** Price in USD cents (e.g. 100 = $1.00) */
  price_usd_cents: number
  /** Human-readable price string e.g. "$1.00" */
  price_display: string
  currency: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface MainlayerAccess {
  resource_id: string
  payer_wallet: string
  granted: boolean
  expires_at?: string
  granted_at?: string
}

export interface MainlayerPayment {
  id: string
  resource_id: string
  payer_wallet: string
  amount_usd_cents: number
  currency: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  created_at: string
  completed_at?: string
}

// ─── Middleware options ───────────────────────────────────────────────────────

export interface MainlayerPaywallOptions {
  /** The resource ID to gate access to */
  resourceId: string
  /** Your Mainlayer API key */
  apiKey: string
  /**
   * Extract the payer wallet/identifier from the request context.
   * Defaults to the `x-payer-wallet` header.
   */
  getPayerWallet?: (c: import('hono').Context) => string | undefined
  /**
   * Custom error handler invoked when payment is required.
   * If not provided, returns a standard 402 JSON response.
   */
  onPaymentRequired?: (
    c: import('hono').Context,
    info: PaymentRequiredInfo,
  ) => Response | Promise<Response>
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface PaymentRequiredInfo {
  error: 'payment_required'
  resource_id: string
  price_usd_cents: number
  price_display: string
  currency: string
  pay_endpoint: string
}

export interface AccessCheckResponse {
  resource_id: string
  payer_wallet: string
  granted: boolean
  expires_at?: string
}

export interface PaymentInitiateRequest {
  resource_id: string
  payer_wallet: string
}

export interface PaymentInitiateResponse {
  payment_id: string
  resource_id: string
  payer_wallet: string
  amount_usd_cents: number
  currency: string
  status: 'pending' | 'completed'
  pay_url?: string
}

export interface DiscoverResponse {
  api_version: string
  base_url: string
  resources_endpoint: string
  pay_endpoint: string
  access_endpoint: string
  supported_currencies: string[]
}

// ─── Client options ───────────────────────────────────────────────────────────

export interface MainlayerClientOptions {
  apiKey: string
  baseUrl?: string
  /** Request timeout in milliseconds (default: 10_000) */
  timeoutMs?: number
}

// ─── Router factory options ───────────────────────────────────────────────────

export interface MainlayerRouteOptions {
  /** Mount prefix for route discovery (default: "/mainlayer") */
  prefix?: string
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class MainlayerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'MainlayerError'
  }
}

export class MainlayerAuthError extends MainlayerError {
  constructor(details?: unknown) {
    super('Invalid or missing Mainlayer API key', 401, 'auth_error', details)
    this.name = 'MainlayerAuthError'
  }
}

export class MainlayerNetworkError extends MainlayerError {
  constructor(message: string, details?: unknown) {
    super(message, 503, 'network_error', details)
    this.name = 'MainlayerNetworkError'
  }
}
