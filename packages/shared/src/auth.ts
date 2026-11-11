import { z } from 'zod';

const email = z
  .email({ error: 'Некорректный email' })
  .max(254)
  .transform((v) => v.trim().toLowerCase());

const password = z
  .string()
  .min(8, { error: 'Пароль — минимум 8 символов' })
  .max(128, { error: 'Пароль — максимум 128 символов' });

export const registerRequestSchema = z.strictObject({
  email,
  password,
  healthConsent: z.literal(true, {
    error: 'Нужно согласие на обработку данных о здоровье',
  }),
  adultConfirmed: z.literal(true, { error: 'Приложение только для 18+' }),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.strictObject({
  email,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const deleteAccountRequestSchema = z.strictObject({
  password: z.string().min(1).max(128),
});

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: PublicUser;
}
