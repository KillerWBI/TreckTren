import { z } from 'zod';
import { config } from '../config.js';

export type JsonMode = 'json_schema' | 'json_object' | 'none';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AiErrorKind = 'not_configured' | 'rate_limited' | 'timeout' | 'http' | 'bad_response';

export class AiError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface JsonRequest<T> {
  /** Имя схемы для response_format. */
  name: string;
  schema: z.ZodType;
  messages: ChatMessage[];
  /** Проверка ответа: схема плюс доменные правила. Ошибки уходят модели на одно исправление. */
  validate: (raw: unknown) => { ok: true; value: T } | { ok: false; errors: string[] };
  maxTokens?: number;
}

export interface JsonResult<T> {
  value: T;
  model: string;
  tokens: number;
}

export interface AiProvider {
  enabled: boolean;
  model: string | null;
  generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode?: JsonMode;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const MODE_ORDER: JsonMode[] = ['json_schema', 'json_object', 'none'];

/**
 * Клиент для любого OpenAI-совместимого API: Gemini, Groq, OpenRouter, Claude.
 * Провайдер меняется переменными AI_BASE_URL, AI_API_KEY и AI_MODEL — без правок кода.
 */
export function openAiCompatible(options: OpenAiCompatibleOptions): AiProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  // Режим, который провайдер принял, запоминаем на время жизни процесса.
  let mode: JsonMode = options.jsonMode ?? 'json_schema';

  async function call(messages: ChatMessage[], request: JsonRequest<unknown>) {
    for (;;) {
      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        temperature: 0.4,
        max_tokens: request.maxTokens ?? 6000,
      };
      if (mode === 'json_schema') {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: request.name, schema: toJsonSchema(request.schema), strict: false },
        };
      } else if (mode === 'json_object') {
        body.response_format = { type: 'json_object' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError')
          throw new AiError('timeout', 'ИИ не ответил вовремя');
        throw new AiError('http', 'ИИ недоступен');
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 429) throw new AiError('rate_limited', 'Лимит запросов к ИИ исчерпан');
      if (res.status === 400 && mode !== 'none') {
        const text = await res.text();
        if (/response_format|json_schema|json_object|schema/i.test(text)) {
          mode = MODE_ORDER[MODE_ORDER.indexOf(mode) + 1]!;
          continue;
        }
        throw new AiError('http', `ИИ отклонил запрос: ${shorten(text)}`);
      }
      if (!res.ok) {
        throw new AiError('http', `ИИ ответил ошибкой ${res.status}: ${shorten(await res.text())}`);
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { total_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new AiError('bad_response', 'ИИ вернул пустой ответ');
      return { content, model: data.model ?? options.model, tokens: data.usage?.total_tokens ?? 0 };
    }
  }

  return {
    enabled: true,
    model: options.model,
    async generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
      const messages = [...request.messages];
      let tokens = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reply = await call(messages, request as JsonRequest<unknown>);
        tokens += reply.tokens;
        let errors: string[];
        const raw = extractJson(reply.content);
        if (raw === undefined) {
          errors = ['Ответ не является JSON-объектом'];
        } else {
          const checked = request.validate(raw);
          if (checked.ok) return { value: checked.value, model: reply.model, tokens };
          errors = checked.errors;
        }
        messages.push(
          { role: 'assistant', content: reply.content },
          {
            role: 'user',
            content: `Ответ не прошёл проверку:\n- ${errors.slice(0, 15).join('\n- ')}\nВерни исправленный JSON целиком, без пояснений.`,
          },
        );
      }
      throw new AiError('bad_response', 'ИИ дважды вернул план, который не прошёл проверку');
    },
  };
}

/** ИИ не подключён: сервис сразу собирает план по правилам. */
export const disabledAi: AiProvider = {
  enabled: false,
  model: null,
  generateJson() {
    return Promise.reject(new AiError('not_configured', 'ИИ не подключён'));
  },
};

export function aiFromConfig(): AiProvider {
  if (!config.AI_API_KEY) return disabledAi;
  return openAiCompatible({
    baseUrl: config.AI_BASE_URL,
    apiKey: config.AI_API_KEY,
    model: config.AI_MODEL,
    jsonMode: config.AI_JSON_MODE,
    timeoutMs: config.AI_TIMEOUT_MS,
  });
}

/** JSON из ответа модели: без ```-обёрток и текста вокруг. */
export function extractJson(content: string): unknown {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Текст ошибки провайдера: обрезан и без того, что похоже на ключи (AIza…, sk-…, gsk_…). */
function shorten(text: string): string {
  return text.replace(/\b(AIza|sk-|gsk_|sk_)[A-Za-z0-9_-]{8,}/g, '$1…').slice(0, 300);
}
