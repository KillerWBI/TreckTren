import type { RequestHandler } from 'express';
import { unauthorized } from '../errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  req.userId = verifyAccessToken(header.slice('Bearer '.length).trim());
  next();
};

/** userId после requireAuth. */
export function userIdOf(req: { userId?: string }): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
