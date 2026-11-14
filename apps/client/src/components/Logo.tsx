import { Link } from 'react-router-dom';

/** Название приложения со знаком-гантелью. Только в боковом меню на ПК и на входе. */
export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="TreckTren, на главную">
      <span className="logo-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="currentColor">
          <rect x="9" y="14.6" width="14" height="2.8" rx="1.2" />
          <rect x="7" y="9.5" width="3.4" height="13" rx="1.5" />
          <rect x="21.6" y="9.5" width="3.4" height="13" rx="1.5" />
          <rect x="4.4" y="12" width="2.8" height="8" rx="1.3" />
          <rect x="24.8" y="12" width="2.8" height="8" rx="1.3" />
        </svg>
      </span>
      TreckTren
    </Link>
  );
}
