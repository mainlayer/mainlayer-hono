/**
 * Edge-compatible Mainlayer API client.
 *
 * Uses only the global `fetch` API — no Node.js built-ins — so it runs in
 * Cloudflare Workers, Deno Deploy, Vercel Edge Functions, and any WinterCG
 * runtime out of the box.
 */

import type {
  AccessCheckResponse,
  MainlayerClientOptions,
  MainlayerResource,
  PaymentInitiateRequest,
  PaymentInitiateResponse,
} from './types.js'
import { MainlayerAuthError, MainlayerError, MainlayerNetworkError } from './types.js'

const DEFAULT_BASE_URL = 'https://api.mainlayer.xyz'
const DEFAULT_TIMEOUT_MS = 10_000

export class MainlayerClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: MainlayerClientOptions) {
    if (!options.apiKey) {
      throw new MainlayerAuthError('apiKey is required')
    }
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private buildHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      const init: RequestInit = {
        method,
        headers: this.buildHeaders(),
        signal: controller.signal,
      }
      if (body !== undefined) {
        init.body = JSON.stringify(body)
      }
      response = await fetch(url, init)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MainlayerNetworkError(
          `Request timed out after ${this.timeoutMs}ms`,
          { url, timeoutMs: this.timeoutMs },
        )
      }
      throw new MainlayerNetworkError(
        `Network request failed: ${err instanceof Error ? err.message : String(err)}`,
        { url, cause: err },
      )
    } finally {
      clearTimeout(timeoutId)
    }

    if (response.status === 401) {
      throw new MainlayerAuthError(await this.safeJson(response))
    }

    if (!response.ok) {
      const errorBody = await this.safeJson(response)
      throw new MainlayerError(
        `Mainlayer API error: ${response.statusText}`,
        response.status,
        (errorBody as Record<string, string>)?.code ?? 'api_error',
        errorBody,
      )
    }

    return response.json() as Promise<T>
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      return await response.text()
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Retrieve metadata for a specific resource.
   */
  async getResource(resourceId: string): Promise<MainlayerResource> {
    if (!resourceId) throw new Error('resourceId is required')
    return this.request<MainlayerResource>('GET', `/v1/resources/${encodeURIComponent(resourceId)}`)
  }

  /**
   * List all resources available under this API key.
   */
  async listResources(): Promise<MainlayerResource[]> {
    const data = await this.request<{ resources: MainlayerResource[] }>('GET', '/v1/resources')
    return data.resources
  }

  /**
   * Check whether a payer has access to a resource.
   */
  async checkAccess(resourceId: string, payerWallet: string): Promise<AccessCheckResponse> {
    if (!resourceId) throw new Error('resourceId is required')
    if (!payerWallet) throw new Error('payerWallet is required')

    return this.request<AccessCheckResponse>(
      'GET',
      `/v1/access/${encodeURIComponent(resourceId)}?payer_wallet=${encodeURIComponent(payerWallet)}`,
    )
  }

  /**
   * Initiate a payment for a resource.
   */
  async initiatePayment(
    payload: PaymentInitiateRequest,
  ): Promise<PaymentInitiateResponse> {
    if (!payload.resource_id) throw new Error('resource_id is required')
    if (!payload.payer_wallet) throw new Error('payer_wallet is required')

    return this.request<PaymentInitiateResponse>('POST', '/v1/payments', payload)
  }

  /**
   * Convenience: check access and, if denied, return the resource info
   * needed to construct a 402 response — all in one round-trip.
   */
  async checkAccessOrGetPaymentInfo(
    resourceId: string,
    payerWallet: string,
  ): Promise<
    | { granted: true; access: AccessCheckResponse }
    | { granted: false; resource: MainlayerResource; access: AccessCheckResponse }
  > {
    const [access, resource] = await Promise.all([
      this.checkAccess(resourceId, payerWallet),
      this.getResource(resourceId),
    ])

    if (access.granted) {
      return { granted: true, access }
    }

    return { granted: false, resource, access }
  }
}

/**
 * Create a pre-configured Mainlayer client instance.
 */
export function createClient(options: MainlayerClientOptions): MainlayerClient {
  return new MainlayerClient(options)
}
