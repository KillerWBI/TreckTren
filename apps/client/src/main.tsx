import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { enableRussianZodErrors } from '@trektren/shared';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/fira-sans-extra-condensed/700.css';
import '@fontsource/fira-sans-extra-condensed/800.css';
import './styles.css';
import { ApiError } from './api/http';
import { AuthProvider } from './auth/AuthContext';
import { App } from './App';

enableRussianZodErrors();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Повторять только сетевые сбои и 5xx; 4xx — это ответ, а не сбой.
      retry: (count, error) =>
        count < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
