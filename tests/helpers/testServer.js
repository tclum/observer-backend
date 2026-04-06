/**
 * helpers/testServer.js
 *
 * Wraps the three Vercel serverless handlers in a lightweight Express server
 * so supertest can hit them over HTTP during E2E tests.
 *
 * Usage:
 *   import { createServer } from '../helpers/testServer.js';
 *   const app = await createServer();
 *   // then use supertest(app).post('/api/auth') ...
 */

import express from 'express';
import authHandler     from '../../api/auth.js';
import configHandler   from '../../api/config.js';
import syncHandler     from '../../api/sync.js';
import missionsHandler from '../../api/missions.js';

/**
 * Adapt a Vercel-style handler (req, res) to Express middleware.
 * Vercel handlers use `res.status(n).json(obj)` — same as Express, so no
 * translation is needed; we just call them directly.
 */
function vercelToExpress(handler) {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

export function createServer() {
  const app = express();
  app.use(express.json());

  app.all('/api/auth',     vercelToExpress(authHandler));
  app.all('/api/config',   vercelToExpress(configHandler));
  app.all('/api/sync',     vercelToExpress(syncHandler));
  app.all('/api/missions', vercelToExpress(missionsHandler));

  return app;
}
