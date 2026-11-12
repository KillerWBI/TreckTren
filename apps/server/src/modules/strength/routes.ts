import { Router } from 'express';
import { strengthUpdateSchema } from '@trektren/shared';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { parseBody } from '../../validate.js';
import { getCard } from '../card/service.js';
import { updateStrength } from './service.js';

export const strengthRouter = Router();

strengthRouter.put('/strength', requireAuth, async (req, res) => {
  const body = parseBody(strengthUpdateSchema, req.body);
  const userId = userIdOf(req);
  const { card } = await getCard(userId);
  const result = await updateStrength(userId, body, card);
  res.json(result ?? { ...(await getCard(userId)), changed: false });
});
