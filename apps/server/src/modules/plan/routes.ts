import { Router } from 'express';
import {
  generatePlanRequestSchema,
  scheduleRequestSchema,
  testResultRequestSchema,
} from '@trektren/shared';
import { z } from 'zod';
import type { AiProvider } from '../../ai/client.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rate-limit.js';
import { notFound } from '../../errors.js';
import { parseBody } from '../../validate.js';
import { loadExercises, toView } from '../exercises/repo.js';
import * as plans from './service.js';

export function createPlanRouter(ai: AiProvider) {
  const router = Router();

  router.get('/exercises', requireAuth, async (_req, res) => {
    res.json((await loadExercises()).map(toView));
  });

  router.get('/plan', requireAuth, async (req, res) => {
    res.json(await plans.getPlan(userIdOf(req), ai));
  });

  router.post('/plan/generate', requireAuth, aiLimiter, async (req, res) => {
    const body = parseBody(generatePlanRequestSchema, req.body);
    res.json(await plans.generatePlan(userIdOf(req), body, ai));
  });

  router.put('/plan/schedule', requireAuth, async (req, res) => {
    const body = parseBody(scheduleRequestSchema, req.body);
    res.json(await plans.updateSchedule(userIdOf(req), body.dates, ai));
  });

  router.post('/plan/sessions/:id/result', requireAuth, async (req, res) => {
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw notFound('Тренировка не найдена');
    const body = parseBody(testResultRequestSchema, req.body);
    res.json(await plans.recordTestResult(userIdOf(req), id.data, body, ai));
  });

  return router;
}
