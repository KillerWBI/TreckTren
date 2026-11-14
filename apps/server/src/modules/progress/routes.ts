import { Router } from 'express';
import type { AiProvider } from '../../ai/client.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rate-limit.js';
import { getPortrait } from './portrait.js';
import { getProgress } from './service.js';
import { createWeeklyReview, latestWeeklyReview } from './weekly.js';

export function createProgressRouter(ai: AiProvider) {
  const router = Router();

  router.get('/portrait', requireAuth, async (req, res) => {
    res.json(await getPortrait(userIdOf(req)));
  });

  router.get('/progress', requireAuth, async (req, res) => {
    const days = Math.min(365, Math.max(14, Number(req.query.days) || 90));
    res.json(await getProgress(userIdOf(req), days));
  });

  router.get('/ai/weekly-review', requireAuth, async (req, res) => {
    res.json({ review: await latestWeeklyReview(userIdOf(req)) });
  });

  router.post('/ai/weekly-review', requireAuth, aiLimiter, async (req, res) => {
    res.status(201).json({ review: await createWeeklyReview(userIdOf(req), ai) });
  });

  return router;
}
