import { Router } from 'express';
import { z } from 'zod';
import { measurementInputSchema } from '@trektren/shared';
import { notFound } from '../../errors.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { parseBody } from '../../validate.js';
import { deleteMeasurement, getMeasurements, saveMeasurement } from './service.js';

export const measurementsRouter = Router();

measurementsRouter.get('/measurements', requireAuth, async (req, res) => {
  res.json(await getMeasurements(userIdOf(req)));
});

measurementsRouter.put('/measurements', requireAuth, async (req, res) => {
  const body = parseBody(measurementInputSchema, req.body);
  res.json(await saveMeasurement(userIdOf(req), body));
});

measurementsRouter.delete('/measurements/:id', requireAuth, async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw notFound('Замер не найден');
  res.json(await deleteMeasurement(userIdOf(req), id.data));
});
