import { Router } from 'express';
import { z } from 'zod';
import { cardPatchRequestSchema, USER_EDITABLE_SECTIONS } from '@trektren/shared';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { parseBody } from '../../validate.js';
import { AppError } from '../../errors.js';
import * as cards from './service.js';

const versionParam = z.coerce.number().int().min(1).max(1_000_000);

function parseVersion(value: unknown): number {
  const result = versionParam.safeParse(value);
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', 'Некорректный номер версии');
  return result.data;
}

export const cardRouter = Router();
cardRouter.use('/card', requireAuth);

cardRouter.get('/card', async (req, res) => {
  res.json(await cards.getCard(userIdOf(req)));
});

cardRouter.patch('/card', async (req, res) => {
  const body = parseBody(cardPatchRequestSchema, req.body);
  const result = await cards.applyCardPatch(userIdOf(req), body.patch, {
    source: 'user',
    reason: body.reason,
    baseVersion: body.baseVersion,
    allowedSections: USER_EDITABLE_SECTIONS,
  });
  res.json(result);
});

cardRouter.get('/card/versions', async (req, res) => {
  res.json(await cards.listVersions(userIdOf(req)));
});

cardRouter.get('/card/versions/:version', async (req, res) => {
  res.json(await cards.getVersion(userIdOf(req), parseVersion(req.params.version)));
});

cardRouter.post('/card/versions/:version/restore', async (req, res) => {
  res.json(await cards.restoreVersion(userIdOf(req), parseVersion(req.params.version)));
});
