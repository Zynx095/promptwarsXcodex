import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import { App } from './App';
import { RouterProvider } from './lib/router';
import { I18nProvider } from './lib/i18n';
import { SessionProvider } from './lib/session';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <RouterProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </RouterProvider>
    </I18nProvider>
  </StrictMode>,
);
