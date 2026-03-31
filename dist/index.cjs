"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  MainlayerAuthError: () => MainlayerAuthError,
  MainlayerClient: () => MainlayerClient,
  MainlayerError: () => MainlayerError,
  MainlayerNetworkError: () => MainlayerNetworkError,
  createClient: () => createClient,
  createMainlayerRoutes: () => createMainlayerRoutes,
  getMainlayerAccess: () => getMainlayerAccess,
  mainlayerPaywall: () => mainlayerPaywall
});
module.exports = __toCommonJS(index_exports);

// src/types.ts
var MainlayerError = class extends Error {
  constructor(message, statusCode, code, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = "MainlayerError";
  }
};
var MainlayerAuthError = class extends MainlayerError {
  constructor(details) {
    super("Invalid or missing Mainlayer API key", 401, "auth_error", details);
    this.name = "MainlayerAuthError";
  }
};
var MainlayerNetworkError = class extends MainlayerError {
  constructor(message, details) {
    super(message, 503, "network_error", details);
    this.name = "MainlayerNetworkError";
  }
};

// src/client.ts
var DEFAULT_BASE_URL = "https://api.mainlayer.xyz";
var DEFAULT_TIMEOUT_MS = 1e4;
var MainlayerClient = class {
  apiKey;
  baseUrl;
  timeoutMs;
  constructor(options) {
    if (!options.apiKey) {
      throw new MainlayerAuthError("apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }
  // ─── Private helpers ────────────────────────────────────────────────────────
  buildHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    };
  }
  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      const init = {
        method,
        headers: this.buildHeaders(),
        signal: controller.signal
      };
      if (body !== void 0) {
        init.body = JSON.stringify(body);
      }
      response = await fetch(url, init);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new MainlayerNetworkError(
          `Request timed out after ${this.timeoutMs}ms`,
          { url, timeoutMs: this.timeoutMs }
        );
      }
      throw new MainlayerNetworkError(
        `Network request failed: ${err instanceof Error ? err.message : String(err)}`,
        { url, cause: err }
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.status === 401) {
      throw new MainlayerAuthError(await this.safeJson(response));
    }
    if (!response.ok) {
      const errorBody = await this.safeJson(response);
      throw new MainlayerError(
        `Mainlayer API error: ${response.statusText}`,
        response.status,
        errorBody?.code ?? "api_error",
        errorBody
      );
    }
    return response.json();
  }
  async safeJson(response) {
    try {
      return await response.json();
    } catch {
      return await response.text();
    }
  }
  // ─── Public API ─────────────────────────────────────────────────────────────
  /**
   * Retrieve metadata for a specific resource.
   */
  async getResource(resourceId) {
    if (!resourceId) throw new Error("resourceId is required");
    return this.request("GET", `/v1/resources/${encodeURIComponent(resourceId)}`);
  }
  /**
   * List all resources available under this API key.
   */
  async listResources() {
    const data = await this.request("GET", "/v1/resources");
    return data.resources;
  }
  /**
   * Check whether a payer has access to a resource.
   */
  async checkAccess(resourceId, payerWallet) {
    if (!resourceId) throw new Error("resourceId is required");
    if (!payerWallet) throw new Error("payerWallet is required");
    return this.request(
      "GET",
      `/v1/access/${encodeURIComponent(resourceId)}?payer_wallet=${encodeURIComponent(payerWallet)}`
    );
  }
  /**
   * Initiate a payment for a resource.
   */
  async initiatePayment(payload) {
    if (!payload.resource_id) throw new Error("resource_id is required");
    if (!payload.payer_wallet) throw new Error("payer_wallet is required");
    return this.request("POST", "/v1/payments", payload);
  }
  /**
   * Convenience: check access and, if denied, return the resource info
   * needed to construct a 402 response — all in one round-trip.
   */
  async checkAccessOrGetPaymentInfo(resourceId, payerWallet) {
    const [access, resource] = await Promise.all([
      this.checkAccess(resourceId, payerWallet),
      this.getResource(resourceId)
    ]);
    if (access.granted) {
      return { granted: true, access };
    }
    return { granted: false, resource, access };
  }
};
function createClient(options) {
  return new MainlayerClient(options);
}

// src/middleware.ts
var DEFAULT_BASE_URL2 = "https://api.mainlayer.xyz";
function defaultGetPayerWallet(c) {
  const header = c.req.header("x-payer-wallet");
  if (header) return header;
  const query = c.req.query("payer_wallet");
  if (query) return query;
  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return void 0;
}
function buildPaymentRequiredInfo(resourceId, resource, baseUrl) {
  return {
    error: "payment_required",
    resource_id: resourceId,
    price_usd_cents: resource.price_usd_cents,
    price_display: resource.price_display,
    currency: resource.currency,
    pay_endpoint: `${baseUrl}/v1/payments`
  };
}
function mainlayerPaywall(options) {
  const { resourceId, apiKey, getPayerWallet, onPaymentRequired } = options;
  const baseUrl = DEFAULT_BASE_URL2;
  if (!resourceId) throw new Error("[mainlayer] resourceId is required");
  if (!apiKey) throw new Error("[mainlayer] apiKey is required");
  const client = new MainlayerClient({ apiKey, baseUrl });
  return async (c, next) => {
    const resolver = getPayerWallet ?? defaultGetPayerWallet;
    const payerWallet = resolver(c);
    if (!payerWallet) {
      const info2 = {
        error: "payment_required",
        resource_id: resourceId,
        price_usd_cents: 0,
        price_display: "see pay_endpoint",
        currency: "USD",
        pay_endpoint: `${baseUrl}/v1/payments`
      };
      if (onPaymentRequired) {
        return onPaymentRequired(c, info2);
      }
      return c.json(info2, 402);
    }
    let result;
    try {
      result = await client.checkAccessOrGetPaymentInfo(resourceId, payerWallet);
    } catch (err) {
      if (err instanceof MainlayerError) {
        return c.json(
          {
            error: "mainlayer_error",
            code: err.code,
            message: err.message
          },
          err.statusCode
        );
      }
      return c.json({ error: "internal_error", message: "Payment check failed" }, 500);
    }
    if (result.granted) {
      c.set("mainlayer_access", result.access);
      c.set("mainlayer_payer_wallet", payerWallet);
      await next();
      return;
    }
    const info = buildPaymentRequiredInfo(resourceId, result.resource, baseUrl);
    if (onPaymentRequired) {
      return onPaymentRequired(c, info);
    }
    return c.json(info, 402);
  };
}
function getMainlayerAccess(c) {
  return {
    access: c.get("mainlayer_access"),
    payerWallet: c.get("mainlayer_payer_wallet")
  };
}

// src/routes.ts
var import_hono = require("hono");
var DEFAULT_BASE_URL3 = "https://api.mainlayer.xyz";
function handleError(c, err) {
  if (err instanceof MainlayerError) {
    return c.json(
      { error: err.code, message: err.message, details: err.details },
      err.statusCode
    );
  }
  const message = err instanceof Error ? err.message : "An unexpected error occurred";
  return c.json({ error: "internal_error", message }, 500);
}
function createMainlayerRoutes(apiKey, options = {}) {
  if (!apiKey) throw new Error("[mainlayer] apiKey is required");
  const baseUrl = DEFAULT_BASE_URL3;
  const client = new MainlayerClient({ apiKey, baseUrl });
  const router = new import_hono.Hono();
  router.get("/discover", async (c) => {
    try {
      const resources = await client.listResources();
      return c.json({
        api_version: "v1",
        integration: "@mainlayer/hono",
        base_url: baseUrl,
        endpoints: {
          discover: `${baseUrl}/v1/resources`,
          pay: `${baseUrl}/v1/payments`,
          access: `${baseUrl}/v1/access/:resourceId`
        },
        resources_endpoint: `${baseUrl}/v1/resources`,
        pay_endpoint: `${baseUrl}/v1/payments`,
        access_endpoint: `${baseUrl}/v1/access/:resourceId`,
        supported_currencies: ["USD"],
        available_resources: resources.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          price_usd_cents: r.price_usd_cents,
          price_display: r.price_display,
          currency: r.currency
        }))
      });
    } catch (err) {
      return handleError(c, err);
    }
  });
  router.post("/pay", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "Request body must be valid JSON" }, 400);
    }
    if (!body.resource_id || typeof body.resource_id !== "string") {
      return c.json(
        { error: "invalid_request", message: "resource_id is required and must be a string" },
        400
      );
    }
    if (!body.payer_wallet || typeof body.payer_wallet !== "string") {
      return c.json(
        { error: "invalid_request", message: "payer_wallet is required and must be a string" },
        400
      );
    }
    try {
      const payment = await client.initiatePayment({
        resource_id: body.resource_id,
        payer_wallet: body.payer_wallet
      });
      return c.json(payment, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });
  router.get("/access/:resourceId", async (c) => {
    const resourceId = c.req.param("resourceId");
    const payerWallet = c.req.query("payer_wallet");
    if (!payerWallet) {
      return c.json(
        { error: "invalid_request", message: "payer_wallet query parameter is required" },
        400
      );
    }
    try {
      const access = await client.checkAccess(resourceId, payerWallet);
      return c.json(access);
    } catch (err) {
      return handleError(c, err);
    }
  });
  return router;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MainlayerAuthError,
  MainlayerClient,
  MainlayerError,
  MainlayerNetworkError,
  createClient,
  createMainlayerRoutes,
  getMainlayerAccess,
  mainlayerPaywall
});
