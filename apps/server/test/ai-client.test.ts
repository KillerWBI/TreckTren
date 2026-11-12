import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { blockTemplateSchema } from '@trektren/shared';
import {
  AiError,
  extractJson,
  openAiCompatible,
  toJsonSchema,
  type JsonRequest,
} from '../src/ai/client.js';

const schema = z.object({ answer: z.number() });

const request: JsonRequest<{ answer: number }> = {
  name: 'test',
  schema,
  messages: [{ role: 'user', content: 'Сколько?' }],
  validate: (raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, errors: ['answer должен быть числом'] };
    if (parsed.data.answer > 100) return { ok: false, errors: ['answer не больше 100'] };
    return { ok: true, value: parsed.data };
  },
};

interface Call {
  url: string;
  body: Record<string, unknown>;
  auth: string | null;
}

function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
      auth: new Headers(init.headers).get('authorization'),
    });
    const next = responses.shift();
    if (!next) throw new Error('лишний запрос');
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const reply =
  (content: string, tokens = 50) =>
  () =>
    Response.json({
      model: 'test-model-001',
      choices: [{ message: { content } }],
      usage: { total_tokens: tokens },
    });

const provider = (impl: typeof fetch) =>
  openAiCompatible({
    baseUrl: 'https://ai.example/v1/',
    apiKey: 'sk-testkey123456789',
    model: 'test-model',
    fetchImpl: impl,
  });

describe('ИИ-клиент', () => {
  it('просит JSON по схеме и возвращает проверенный ответ', async () => {
    const { impl, calls } = fakeFetch([reply('{"answer": 42}')]);
    const result = await provider(impl).generateJson(request);
    expect(result).toEqual({ value: { answer: 42 }, model: 'test-model-001', tokens: 50 });
    expect(calls[0]!.url).toBe('https://ai.example/v1/chat/completions');
    expect(calls[0]!.auth).toBe('Bearer sk-testkey123456789');
    expect(calls[0]!.body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'test' },
    });
  });

  it('провайдер без json_schema — переходит на json_object', async () => {
    const { impl, calls } = fakeFetch([
      () =>
        new Response('{"error":"response_format json_schema is not supported"}', { status: 400 }),
      reply('{"answer": 7}'),
    ]);
    const ai = provider(impl);
    expect((await ai.generateJson(request)).value).toEqual({ answer: 7 });
    expect(calls[1]!.body.response_format).toEqual({ type: 'json_object' });
    // Режим запоминается: следующий запрос сразу без json_schema.
    const second = fakeFetch([reply('{"answer": 8}')]);
    const ai2 = openAiCompatible({
      baseUrl: 'https://ai.example/v1',
      apiKey: 'k',
      model: 'm',
      jsonMode: 'none',
      fetchImpl: second.impl,
    });
    await ai2.generateJson(request);
    expect(second.calls[0]!.body.response_format).toBeUndefined();
  });

  it('непонятный 400 (как у Gemini) — тоже пробует режим попроще, схема уходит в промпт', async () => {
    const { impl, calls } = fakeFetch([
      () =>
        new Response('[{"error":{"code":400,"message":"Request contains an invalid argument."}}]', {
          status: 400,
        }),
      reply('{"answer": 3}'),
    ]);
    const withSystem = {
      ...request,
      messages: [{ role: 'system' as const, content: 'Ты тренер.' }, ...request.messages],
    };
    expect((await provider(impl).generateJson(withSystem)).value).toEqual({ answer: 3 });
    expect(calls[1]!.body.response_format).toEqual({ type: 'json_object' });
    const messages = calls[1]!.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]!.content).toMatch(/^Ты тренер\.[\s\S]*JSON Schema[\s\S]*"answer"/);
    expect(messages).toHaveLength(2);
  });

  it('в схеме для провайдера только общепонятные ключи', () => {
    const json = JSON.stringify(toJsonSchema(blockTemplateSchema));
    for (const key of ['additionalProperties', 'pattern', 'minLength', 'maxLength', '$schema']) {
      expect(json).not.toContain(`"${key}"`);
    }
    expect(json).toContain('"required"');
    expect(json).toContain('"minItems"');
  });

  it('ответ обрезан по лимиту — понятная ошибка', async () => {
    const { impl } = fakeFetch([
      () => Response.json({ choices: [{ message: { content: null }, finish_reason: 'length' }] }),
    ]);
    await expect(provider(impl).generateJson(request)).rejects.toMatchObject({
      kind: 'bad_response',
      message: 'ИИ не уложился в лимит ответа',
    });
  });

  it('невалидный ответ отправляет модели на одно исправление', async () => {
    const { impl, calls } = fakeFetch([
      reply('```json\n{"answer": 500}\n```', 30),
      reply('Вот: {"answer": 99}', 40),
    ]);
    const result = await provider(impl).generateJson(request);
    expect(result.value).toEqual({ answer: 99 });
    expect(result.tokens).toBe(70);
    const messages = calls[1]!.body.messages as Array<{ role: string; content: string }>;
    expect(messages.at(-1)!.content).toMatch(/answer не больше 100/);
  });

  it('два невалидных ответа подряд — ошибка', async () => {
    const { impl } = fakeFetch([reply('не json'), reply('{"answer": "x"}')]);
    await expect(provider(impl).generateJson(request)).rejects.toMatchObject({
      kind: 'bad_response',
    });
  });

  it('429 — лимит, ошибка провайдера — без ключей в тексте', async () => {
    const limited = fakeFetch([() => new Response('slow down', { status: 429 })]);
    await expect(provider(limited.impl).generateJson(request)).rejects.toMatchObject({
      kind: 'rate_limited',
    });

    const failed = fakeFetch([
      () => new Response('API key AIzaSyA1234567890abcdefXYZ is invalid', { status: 403 }),
    ]);
    const err = (await provider(failed.impl)
      .generateJson(request)
      .catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('http');
    expect(err.message).not.toContain('1234567890');
  });

  it('достаёт JSON из ответа с текстом вокруг', () => {
    expect(extractJson('Конечно!\n```json\n{"a": {"b": 1}}\n```')).toEqual({ a: { b: 1 } });
    expect(extractJson('нет json')).toBeUndefined();
    expect(extractJson('{битый')).toBeUndefined();
  });
});
