/**
 * Cloudflare Workers example with Hono + Mainlayer
 *
 * Deploy with: npx wrangler deploy
 * Set secrets with: npx wrangler secret put MAINLAYER_API_KEY
 */

import { Hono } from 'hono';
import { mainlayerPaywall, createMainlayerRoutes, getMainlayerAccess } from '../src/index';

type Env = {
  Bindings: {
    MAINLAYER_API_KEY: string;
  };
};

const app = new Hono<Env>();

// Mount Mainlayer management routes
app.route('/mainlayer', (c) => {
  const routes = createMainlayerRoutes(c.env.MAINLAYER_API_KEY);
  return routes.fetch(c.req.raw);
});

// Public endpoint
app.get('/', (c) => {
  return c.json({ message: 'Welcome to Mainlayer on Cloudflare Workers' });
});

// Premium endpoint gated by payment
app.get(
  '/api/premium',
  async (c, next) =>
    mainlayerPaywall({
      resourceId: 'res_worker_premium',
      apiKey: c.env.MAINLAYER_API_KEY,
    })(c, next),
  (c) => {
    const { payerWallet } = getMainlayerAccess(c);
    return c.json({
      message: 'This is premium content',
      wallet: payerWallet,
      timestamp: new Date().toISOString(),
    });
  }
);

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
