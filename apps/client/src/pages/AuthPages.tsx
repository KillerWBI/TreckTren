import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loginRequestSchema, registerRequestSchema } from '@trektren/shared';
import { fieldErrorsFrom } from '../api/http';
import { useAuth } from '../auth/AuthContext';
import { Sleeve } from '../components/Sleeve';
import { SECTIONS } from '../card/sections';

const fullSleeve = SECTIONS.map((s) => ({
  id: s.key,
  plate: s.plate,
  filled: true,
  label: s.title,
}));

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <p className="wordmark">TreckTren</p>
      <Sleeve slots={fullSleeve} title="Штанга с блинами" />
      <h1 className="page-title">{title}</h1>
      {children}
    </main>
  );
}

function useErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  return { errors, setErrors, formError, setFormError };
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { errors, setErrors, formError, setFormError } = useErrors();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await login({ email, password });
      navigate('/', { replace: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Не получилось войти.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Вход">
      <form className="editor" onSubmit={(e) => void onSubmit(e)} noValidate>
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
        />
        <TextField
          id="password"
          label="Пароль"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button type="submit" className="button button-wide" disabled={busy}>
          {busy ? 'Вхожу…' : 'Войти'}
        </button>
      </form>
      <p className="auth-switch">
        Нет аккаунта? <Link to="/register">Создать аккаунт</Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [healthConsent, setHealthConsent] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { errors, setErrors, formError, setFormError } = useErrors();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const input = { email, password, healthConsent, adultConfirmed };
    const parsed = registerRequestSchema.safeParse(input);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.error.issues) map[issue.path.join('.')] ??= issue.message;
      setErrors(map);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await register({ email, password, healthConsent: true, adultConfirmed: true });
      navigate('/', { replace: true });
    } catch (err) {
      const fields = fieldErrorsFrom(err);
      setErrors(fields);
      setFormError(err instanceof Error ? err.message : 'Не получилось создать аккаунт.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Новый аккаунт">
      <form className="editor" onSubmit={(e) => void onSubmit(e)} noValidate>
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
        />
        <TextField
          id="password"
          label="Пароль"
          type="password"
          autoComplete="new-password"
          hint="Минимум 8 символов."
          value={password}
          onChange={setPassword}
          error={errors.password}
        />
        <Consent
          id="health"
          checked={healthConsent}
          onChange={setHealthConsent}
          error={errors.healthConsent}
          text="Согласен на обработку данных о здоровье: вес, питание, сон, самочувствие, тренировки. Тренер считает по ним план; для расчётов данные передаются ИИ-сервису Anthropic."
        />
        <Consent
          id="adult"
          checked={adultConfirmed}
          onChange={setAdultConfirmed}
          error={errors.adultConfirmed}
          text="Мне есть 18 лет."
        />
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button type="submit" className="button button-wide" disabled={busy}>
          {busy ? 'Создаю…' : 'Создать аккаунт'}
        </button>
      </form>
      <p className="auth-switch">
        Уже есть аккаунт? <Link to="/login">Войти</Link>
      </p>
    </AuthLayout>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: string;
}

function TextField({
  id,
  label,
  type,
  autoComplete,
  value,
  onChange,
  error,
  hint,
}: TextFieldProps) {
  const describedBy =
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function Consent({
  id,
  checked,
  onChange,
  text,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  text: string;
  error?: string | undefined;
}) {
  return (
    <div className="field">
      <label className="check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{text}</span>
      </label>
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
