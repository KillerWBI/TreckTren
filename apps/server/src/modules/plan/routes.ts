import { Router } from 'express';
import {
  baselineRequestSchema,
  generatePlanRequestSchema,
  scheduleRequestSchema,
} from '@trektren/shared';
import type { AiProvider } from '../../ai/client.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
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

  router.post('/plan/generate', requireAuth, async (req, res) => {
    const body = parseBody(generatePlanRequestSchema, req.body);
    res.json(await plans.generatePlan(userIdOf(req), body, ai));
  });

  router.put('/plan/schedule', requireAuth, async (req, res) => {
    const body = parseBody(scheduleRequestSchema, req.body);
    res.json(await plans.updateSchedule(userIdOf(req), body.dates, ai));
  });

  router.post('/strength/baseline', requireAuth, async (req, res) => {
    const body = parseBody(baselineRequestSchema, req.body);
    res.json(await plans.saveBaseline(userIdOf(req), body));
  });

  return router;
}
