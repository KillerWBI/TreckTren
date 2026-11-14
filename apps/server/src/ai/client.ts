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

/** Задачи, под которые можно поставить свою модель. */
export type AiTask = 'plan' | 'food' | 'note' | 'review';

export interface JsonRequest<T> {
  /** Имя схемы для response_format. */
  name: string;
  /** Под какую задачу запрос: выбирает модель из AI_MODEL_<ЗАДАЧА>. */
  task?: AiTask;
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
  /** Модели по задачам; нет — model. */
  taskModels?: Partial<Record<AiTask, string>>;
  temperature?: number | undefined;
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
  const strict = /anthropic\.com/.test(baseUrl);
  // Режим, который провайдер принял, запоминаем на время жизни процесса.
  let mode: JsonMode = options.jsonMode ?? 'json_schema';

  async function call(messages: ChatMessage[], request: JsonRequest<unknown>) {
    const schema = toJsonSchema(request.schema);
    for (;;) {
      const model = (request.task && options.taskModels?.[request.task]) || options.model;
      const body: Record<string, unknown> = {
        model,
        // Без json_schema модель не видит схему из response_format — кладём её в промпт.
        messages: mode === 'json_schema' ? messages : withSchemaInPrompt(messages, schema),
        // С запасом: у думающих моделей (Gemini 3) рассуждения тоже считаются в этот лимит.
        max_tokens: request.maxTokens ?? 16_000,
      };
      if (options.temperature !== undefined) body.temperature = options.temperature;
      if (mode === 'json_schema') {
        // Claude принимает только строгую схему; Gemini строгую с additionalProperties отклоняет.
        body.response_format = {
          type: 'json_schema',
          json_schema: strict
            ? { name: request.name, schema: strictSchema(schema), strict: true }
            : { name: request.name, schema },
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
        // Провайдеры по-разному сообщают, что не понимают response_format (Gemini — просто
        // «invalid argument»), поэтому на любой 400 пробуем режим попроще.
        const text = await res.text();
        const next = MODE_ORDER[MODE_ORDER.indexOf(mode) + 1]!;
        console.warn(`[ai] ${mode} не принят (${shorten(text, 160)}), пробую ${next}`);
        mode = next;
        continue;
      }
      if (res.status === 400) {
        throw new AiError('http', `ИИ отклонил запрос: ${shorten(await res.text())}`);
      }
      if (!res.ok) {
        throw new AiError('http', `ИИ ответил ошибкой ${res.status}: ${shorten(await res.text())}`);
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
        usage?: { total_tokens?: number };
      };
      const choice = data.choices?.[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new AiError(
          'bad_response',
          choice?.finish_reason === 'length'
            ? 'ИИ не уложился в лимит ответа'
            : 'ИИ вернул пустой ответ',
        );
      }
      return { content, model: data.model ?? model, tokens: data.usage?.total_tokens ?? 0 };
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
        // В строгом режиме необязательные поля приходят как null — для наших схем это «нет поля».
        const raw = stripNulls(extractJson(reply.content));
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
    taskModels: {
      ...(config.AI_MODEL_PLAN ? { plan: config.AI_MODEL_PLAN } : {}),
      ...(config.AI_MODEL_FOOD ? { food: config.AI_MODEL_FOOD } : {}),
      ...(config.AI_MODEL_NOTE ? { note: config.AI_MODEL_NOTE } : {}),
      ...(config.AI_MODEL_REVIEW ? { review: config.AI_MODEL_REVIEW } : {}),
    },
    temperature: config.AI_TEMPERATURE,
    jsonMode: config.AI_JSON_MODE,
    timeoutMs: config.AI_TIMEOUT_MS,
  });
}

export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, stripNulls(v)]),
  );
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

/** Ключи JSON Schema, которые понимают все OpenAI-совместимые провайдеры, включая Gemini. */
const SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'description',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
]);

/**
 * Схема для response_format без того, на чём спотыкаются провайдеры:
 * additionalProperties, pattern, длины строк, $schema. Эти правила всё равно проверяет zod.
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return simplify(z.toJSONSchema(schema, { unrepresentable: 'any' })) as Record<string, unknown>;
}

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (typeof node !== 'object' || node === null) return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties') {
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, simplify(v)]),
      );
    } else {
      result[key] = simplify(value);
    }
  }
  return result;
}

/**
 * Строгая схема (strict: true): у каждого объекта все поля обязательны и лишние запрещены.
 * Необязательные поля становятся «тип или null» — так требует строгий режим.
 */
export function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (typeof node !== 'object' || node === null) return node;
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n)) {
    out[k] = k === 'properties' ? v : strictSchema(v);
  }
  if (n.type === 'object' && n.properties && typeof n.properties === 'object') {
    const props = n.properties as Record<string, unknown>;
    const required = new Set((n.required as string[] | undefined) ?? []);
    out.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => {
        const child = strictSchema(v) as Record<string, unknown>;
        return [k, required.has(k) ? child : nullable(child)];
      }),
    );
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  return { anyOf: [schema, { type: 'null' }] };
}

function withSchemaInPrompt(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
): ChatMessage[] {
  const note = `\n\nОтвет — один JSON-объект строго по этой JSON Schema:\n${JSON.stringify(schema)}`;
  const index = messages.findIndex((m) => m.role === 'system');
  if (index === -1) return [{ role: 'system', content: note.trim() }, ...messages];
  return messages.map((m, i) => (i === index ? { ...m, content: m.content + note } : m));
}

/** Текст ошибки провайдера: обрезан и без того, что похоже на ключи (AIza…, sk-…, gsk_…). */
function shorten(text: string, max = 300): string {
  return text
    .replace(/\b(AIza|sk-|gsk_|sk_)[A-Za-z0-9_-]{8,}/g, '$1…')
    .replace(/\s+/g, ' ')
    .slice(0, max);
}
