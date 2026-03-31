/**
 * @mainlayer/hono middleware tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mainlayerPaywall, getMainlayerAccess } from '../src/middleware';
import { MainlayerClient } from '../src/client';

vi.mock('../src/client');

describe('mainlayerPaywall middleware', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    vi.clearAllMocks();
  });

  it('grants access when wallet has entitlement', async () => {
    const mockClient = {
      checkAccessOrGetPaymentInfo: vi.fn().mockResolvedValue({
        granted: true,
        access: { resource_id: 'res_123', granted_at: '2024-01-01' },
      }),
    };

    vi.mocked(MainlayerClient).mockImplementation(() => mockClient as any);

    app.get(
      '/premium',
      mainlayerPaywall({ resourceId: 'res_123', apiKey: 'test_key' }),
      (c) => {
        const { payerWallet } = getMainlayerAccess(c);
        return c.json({ access: true, wallet: payerWallet });
      }
    );

    const req = new Request('http://localhost/premium', {
      headers: { 'x-payer-wallet': '0xABC' },
    });

    const res = await app.request(req);
    expect(res.status).toBe(200);
  });

  it('returns 402 when wallet has no entitlement', async () => {
    const mockClient = {
      checkAccessOrGetPaymentInfo: vi.fn().mockResolvedValue({
        granted: false,
        resource: {
          price_usd_cents: 100,
          price_display: '$1.00',
          currency: 'USD',
        },
      }),
    };

    vi.mocked(MainlayerClient).mockImplementation(() => mockClient as any);

    app.get(
      '/premium',
      mainlayerPaywall({ resourceId: 'res_123', apiKey: 'test_key' }),
      (c) => c.json({ error: 'unreachable' })
    );

    const req = new Request('http://localhost/premium', {
      headers: { 'x-payer-wallet': '0xABC' },
    });

    const res = await app.request(req);
    expect(res.status).toBe(402);

    const body = await res.json();
    expect(body.error).toBe('payment_required');
    expect(body.price_usd_cents).toBe(100);
  });

  it('resolves payer wallet from header', async () => {
    const mockClient = {
      checkAccessOrGetPaymentInfo: vi.fn().mockResolvedValue({
        granted: true,
        access: {},
      }),
    };

    vi.mocked(MainlayerClient).mockImplementation(() => mockClient as any);

    app.get(
      '/api',
      mainlayerPaywall({ resourceId: 'res_123', apiKey: 'test_key' }),
      (c) => c.json({ ok: true })
    );

    const req = new Request('http://localhost/api', {
      headers: { 'x-payer-wallet': '0xDEF' },
    });

    await app.request(req);

    expect(mockClient.checkAccessOrGetPaymentInfo).toHaveBeenCalledWith('res_123', '0xDEF');
  });

  it('resolves payer wallet from query param', async () => {
    const mockClient = {
      checkAccessOrGetPaymentInfo: vi.fn().mockResolvedValue({
        granted: true,
        access: {},
      }),
    };

    vi.mocked(MainlayerClient).mockImplementation(() => mockClient as any);

    app.get(
      '/api',
      mainlayerPaywall({ resourceId: 'res_123', apiKey: 'test_key' }),
      (c) => c.json({ ok: true })
    );

    const req = new Request('http://localhost/api?payer_wallet=0xGHI');

    await app.request(req);

    expect(mockClient.checkAccessOrGetPaymentInfo).toHaveBeenCalledWith('res_123', '0xGHI');
  });

  it('resolves payer wallet from Authorization header', async () => {
    const mockClient = {
      checkAccessOrGetPaymentInfo: vi.fn().mockResolvedValue({
        granted: true,
        access: {},
      }),
    };

    vi.mocked(MainlayerClient).mockImplementation(() => mockClient as any);

    app.get(
      '/api',
      mainlayerPaywall({ resourceId: 'res_123', apiKey: 'test_key' }),
      (c) => c.json({ ok: true })
    );

    const req = new Request('http://localhost/api', {
      headers: { 'Authorization': 'Bearer 0xJKL' },
    });

    await app.request(req);

    expect(mockClient.checkAccessOrGetPaymentInfo).toHaveBeenCalledWith('res_123', '0xJKL');
  });

  it('uses custom onPaymentRequired callback', async () => {
    const mockClient = {
      checkAccessOrGetPaymentInfo: vi.fn().mockResolvedValue({
        granted: false,
        resource: {
          price_usd_cents: 100,
          price_display: '$1.00',
          currency: 'USD',
        },
      }),
    };

    vi.mocked(MainlayerClient).mockImplementation(() => mockClient as any);

    app.get(
      '/premium',
      mainlayerPaywall({
        resourceId: 'res_123',
        apiKey: 'test_key',
        onPaymentRequired: (c, info) =>
          c.json({ custom: true, info }, 402),
      }),
      (c) => c.json({ error: 'unreachable' })
    );

    const req = new Request('http://localhost/premium', {
      headers: { 'x-payer-wallet': '0xABC' },
    });

    const res = await app.request(req);
    const body = await res.json();

    expect(body.custom).toBe(true);
    expect(body.info.error).toBe('payment_required');
  });
});
