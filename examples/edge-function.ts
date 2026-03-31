/**
 * Vercel Edge Function example with Hono + Mainlayer
 *
 * Place in: api/route.ts (Next.js 13+ App Router)
 */

import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { mainlayerPaywall } from '../src/index';

export const runtime = 'edge';

const app = new Hono().basePath('/api');

app.get(
  '/gated',
  async (c, next) =>
    mainlayerPaywall({
      resourceId: 'res_edge_api',
      apiKey: process.env.MAINLAYER_API_KEY!,
    })(c, next),
  (c) => c.json({ data: 'Edge function response' })
);

export const GET = handle(app);
