import type { RequestHandler } from 'express';

/** Лог запроса без тела, query и заголовков: метод, путь, статус, время. */
export const requestLog: RequestHandler = (req, res, next) => {
  const started = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - started);
    // Полный путь без query: в query могут оказаться данные пользователя.
    const path = req.originalUrl.split('?')[0];
    console.log(`${req.method} ${path} ${res.statusCode} ${ms}ms`);
  });
  next();
};
