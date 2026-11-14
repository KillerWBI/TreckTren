import { Router } from 'express';
import { finishWorkoutSchema, startWorkoutSchema, workoutSetSchema } from '@trektren/shared';
import type { AiProvider } from '../../ai/client.js';
import { notFound } from '../../errors.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rate-limit.js';
import { parseBody } from '../../validate.js';
import * as workouts from './service.js';

export function createWorkoutRouter(ai: AiProvider) {
  const router = Router();

  router.post('/workouts', requireAuth, async (req, res) => {
    const body = parseBody(startWorkoutSchema, req.body ?? {});
    res.status(201).json(await workouts.startWorkout(userIdOf(req), body));
  });

  router.get('/workouts/:id', requireAuth, async (req, res) => {
    res.json(await workouts.getWorkout(userIdOf(req), String(req.params.id)));
  });

  router.put('/workouts/:id/sets', requireAuth, async (req, res) => {
    const body = parseBody(workoutSetSchema, req.body);
    res.json(await workouts.saveSet(userIdOf(req), String(req.params.id), body));
  });

  router.delete('/workouts/:id/sets/:slug/:setNo', requireAuth, async (req, res) => {
    const setNo = Number(req.params.setNo);
    if (!Number.isInteger(setNo) || setNo < 1) throw notFound('Подход не найден');
    await workouts.deleteSet(userIdOf(req), String(req.params.id), String(req.params.slug), setNo);
    res.status(204).end();
  });

  router.post('/workouts/:id/finish', requireAuth, aiLimiter, async (req, res) => {
    const body = parseBody(finishWorkoutSchema, req.body ?? {});
    res.json(await workouts.finishWorkout(userIdOf(req), String(req.params.id), body.notes, ai));
  });

  return router;
}
