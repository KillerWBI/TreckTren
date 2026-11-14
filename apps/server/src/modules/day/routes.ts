import { Router } from 'express';
import {
  calorieAdjustSchema,
  mealInputSchema,
  mealParseSchema,
  stepsInputSchema,
  TIMES_OF_DAY,
  weightInputSchema,
  wellbeingInputSchema,
  type TimeOfDay,
} from '@trektren/shared';
import { z } from 'zod';
import type { AiProvider } from '../../ai/client.js';
import { notFound } from '../../errors.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rate-limit.js';
import { parseBody } from '../../validate.js';
import * as day from './service.js';

const isoDate = z.iso.date();

function dateParam(value: unknown): string {
  const r = isoDate.safeParse(value);
  if (!r.success) throw notFound('День не найден');
  return r.data;
}

export function createDayRouter(ai: AiProvider) {
  const router = Router();

  router.get('/day/:date', requireAuth, async (req, res) => {
    res.json(await day.getDay(userIdOf(req), dateParam(req.params.date)));
  });

  router.put('/weights', requireAuth, async (req, res) => {
    const body = parseBody(weightInputSchema, req.body);
    await day.putWeight(userIdOf(req), body.date, body.timeOfDay, body.weightKg);
    res.json(await day.getDay(userIdOf(req), body.date));
  });

  router.delete('/weights/:date/:timeOfDay', requireAuth, async (req, res) => {
    const date = dateParam(req.params.date);
    const time = String(req.params.timeOfDay);
    if (!(TIMES_OF_DAY as readonly string[]).includes(time))
      throw notFound('Взвешивание не найдено');
    await day.deleteWeight(userIdOf(req), date, time as TimeOfDay);
    res.json(await day.getDay(userIdOf(req), date));
  });

  router.put('/steps/:date', requireAuth, async (req, res) => {
    const date = dateParam(req.params.date);
    const body = parseBody(stepsInputSchema, req.body);
    await day.putSteps(userIdOf(req), date, body.steps);
    res.json(await day.getDay(userIdOf(req), date));
  });

  router.put('/wellbeing/:date', requireAuth, async (req, res) => {
    const date = dateParam(req.params.date);
    const body = parseBody(wellbeingInputSchema, req.body);
    await day.putWellbeing(userIdOf(req), date, body);
    res.json(await day.getDay(userIdOf(req), date));
  });

  router.post('/meals', requireAuth, async (req, res) => {
    const body = parseBody(mealInputSchema, req.body);
    await day.addMeal(userIdOf(req), body);
    res.status(201).json(await day.getDay(userIdOf(req), body.date));
  });

  router.delete('/meals/:id', requireAuth, async (req, res) => {
    await day.deleteMeal(userIdOf(req), String(req.params.id));
    res.status(204).end();
  });

  router.post('/meals/parse', requireAuth, aiLimiter, async (req, res) => {
    const body = parseBody(mealParseSchema, req.body);
    res.json(await day.parseMeal(userIdOf(req), body.text, ai));
  });

  router.put('/nutrition/adjust', requireAuth, async (req, res) => {
    const body = parseBody(calorieAdjustSchema, req.body);
    await day.setCalorieAdjust(userIdOf(req), body.kcal);
    res.status(204).end();
  });

  return router;
}
