import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { enableRussianZodErrors } from '@trektren/shared';
import '@fontsource-variable/nunito/index.css';
import './styles.css';
import { ApiError } from './api/http';
import { AuthProvider } from './auth/AuthContext';
import { App } from './App';
import { startOutbox } from './offline/outbox';

enableRussianZodErrors();
startOutbox();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Повторять только сетевые сбои и 5xx; 4xx — это ответ, а не сбой.
      retry: (count, error) =>
        count < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
    },
    // Без сети запрос не «зависает»: записи уходят в очередь на телефоне,
    // остальное сразу показывает ошибку «нет связи».
    mutations: { networkMode: 'always' },
  },
});

// Портрет зависит от карточки, веса и тренировок: обновился любой из них — перерисовать.
queryClient.getQueryCache().subscribe((event) => {
  if (event.type !== 'updated' || event.action.type !== 'success') return;
  const root = event.query.queryKey[0];
  if (root === 'card' || root === 'day' || root === 'workout') {
    void queryClient.invalidateQueries({ queryKey: ['portrait'] });
    void queryClient.invalidateQueries({ queryKey: ['progress'] });
  }
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
