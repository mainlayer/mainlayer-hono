import * as hono from 'hono';
import { Context, MiddlewareHandler, Hono } from 'hono';

/**
 * TypeScript types for @mainlayer/hono
 */
interface MainlayerResource {
    id: string;
    name: string;
    description?: string;
    /** Price in USD cents (e.g. 100 = $1.00) */
    price_usd_cents: number;
    /** Human-readable price string e.g. "$1.00" */
    price_display: string;
    currency: string;
    active: boolean;
    created_at: string;
    updated_at: string;
}
interface MainlayerAccess {
    resource_id: string;
    payer_wallet: string;
    granted: boolean;
    expires_at?: string;
    granted_at?: string;
}
interface MainlayerPayment {
    id: string;
    resource_id: string;
    payer_wallet: string;
    amount_usd_cents: number;
    currency: string;
    status: 'pending' | 'completed' | 'failed' | 'refunded';
    created_at: string;
    completed_at?: string;
}
interface MainlayerPaywallOptions {
    /** The resource ID to gate access to */
    resourceId: string;
    /** Your Mainlayer API key */
    apiKey: string;
    /**
     * Extract the payer wallet/identifier from the request context.
     * Defaults to the `x-payer-wallet` header.
     */
    getPayerWallet?: (c: hono.Context) => string | undefined;
    /**
     * Custom error handler invoked when payment is required.
     * If not provided, returns a standard 402 JSON response.
     */
    onPaymentRequired?: (c: hono.Context, info: PaymentRequiredInfo) => Response | Promise<Response>;
}
interface PaymentRequiredInfo {
    error: 'payment_required';
    resource_id: string;
    price_usd_cents: number;
    price_display: string;
    currency: string;
    pay_endpoint: string;
}
interface AccessCheckResponse {
    resource_id: string;
    payer_wallet: string;
    granted: boolean;
    expires_at?: string;
}
interface PaymentInitiateRequest {
    resource_id: string;
    payer_wallet: string;
}
interface PaymentInitiateResponse {
    payment_id: string;
    resource_id: string;
    payer_wallet: string;
    amount_usd_cents: number;
    currency: string;
    status: 'pending' | 'completed';
    pay_url?: string;
}
interface DiscoverResponse {
    api_version: string;
    base_url: string;
    resources_endpoint: string;
    pay_endpoint: string;
    access_endpoint: string;
    supported_currencies: string[];
}
interface MainlayerClientOptions {
    apiKey: string;
    baseUrl?: string;
    /** Request timeout in milliseconds (default: 10_000) */
    timeoutMs?: number;
}
interface MainlayerRouteOptions {
    /** Mount prefix for route discovery (default: "/mainlayer") */
    prefix?: string;
}
declare class MainlayerError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: unknown | undefined;
    constructor(message: string, statusCode: number, code: string, details?: unknown | undefined);
}
declare class MainlayerAuthError extends MainlayerError {
    constructor(details?: unknown);
}
declare class MainlayerNetworkError extends MainlayerError {
    constructor(message: string, details?: unknown);
}

/**
 * Hono middleware for Mainlayer payment gating.
 *
 * Drop this in front of any route handler to require payment before access
 * is granted. Fully edge-compatible — no Node.js APIs used.
 */

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
declare function mainlayerPaywall(options: MainlayerPaywallOptions): MiddlewareHandler;
/**
 * Retrieve Mainlayer access metadata set by the paywall middleware.
 * Must be called inside a handler that sits behind `mainlayerPaywall`.
 */
declare function getMainlayerAccess(c: Context): {
    access: ReturnType<typeof c.get> | undefined;
    payerWallet: string | undefined;
};

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

/**
 * Create a Hono app (router) pre-wired with Mainlayer routes.
 *
 * Mount it on your main app with `app.route(prefix, createMainlayerRoutes(key))`.
 */
declare function createMainlayerRoutes(apiKey: string, options?: MainlayerRouteOptions): Hono;

/**
 * Edge-compatible Mainlayer API client.
 *
 * Uses only the global `fetch` API — no Node.js built-ins — so it runs in
 * Cloudflare Workers, Deno Deploy, Vercel Edge Functions, and any WinterCG
 * runtime out of the box.
 */

declare class MainlayerClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeoutMs;
    constructor(options: MainlayerClientOptions);
    private buildHeaders;
    private request;
    private safeJson;
    /**
     * Retrieve metadata for a specific resource.
     */
    getResource(resourceId: string): Promise<MainlayerResource>;
    /**
     * List all resources available under this API key.
     */
    listResources(): Promise<MainlayerResource[]>;
    /**
     * Check whether a payer has access to a resource.
     */
    checkAccess(resourceId: string, payerWallet: string): Promise<AccessCheckResponse>;
    /**
     * Initiate a payment for a resource.
     */
    initiatePayment(payload: PaymentInitiateRequest): Promise<PaymentInitiateResponse>;
    /**
     * Convenience: check access and, if denied, return the resource info
     * needed to construct a 402 response — all in one round-trip.
     */
    checkAccessOrGetPaymentInfo(resourceId: string, payerWallet: string): Promise<{
        granted: true;
        access: AccessCheckResponse;
    } | {
        granted: false;
        resource: MainlayerResource;
        access: AccessCheckResponse;
    }>;
}
/**
 * Create a pre-configured Mainlayer client instance.
 */
declare function createClient(options: MainlayerClientOptions): MainlayerClient;

export { type AccessCheckResponse, type DiscoverResponse, type MainlayerAccess, MainlayerAuthError, MainlayerClient, type MainlayerClientOptions, MainlayerError, MainlayerNetworkError, type MainlayerPayment, type MainlayerPaywallOptions, type MainlayerResource, type MainlayerRouteOptions, type PaymentInitiateRequest, type PaymentInitiateResponse, type PaymentRequiredInfo, createClient, createMainlayerRoutes, getMainlayerAccess, mainlayerPaywall };
