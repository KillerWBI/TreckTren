import path from 'node:path';
import { existsSync } from 'node:fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { enableRussianZodErrors } from '@trektren/shared';
import { config, isTest } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestLog } from './middleware/request-log.js';
import { authRouter } from './modules/auth/routes.js';
import { cardRouter } from './modules/card/routes.js';

enableRussianZodErrors();

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY > 0) app.set('trust proxy', config.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    }),
  );
  if (!isTest) app.use(requestLog);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(authRouter);
  api.use(cardRouter);
  api.use(notFoundHandler);
  app.use('/api/v1', api);

  // Продакшен: клиент и API на одном домене — refresh-cookie работает с SameSite=Strict.
  const clientDir = config.CLIENT_DIST_DIR ? path.resolve(config.CLIENT_DIST_DIR) : undefined;
  if (clientDir && existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
