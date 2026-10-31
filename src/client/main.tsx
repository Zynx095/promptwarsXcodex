import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import './styles/primitives.css';
import './styles/shell.css';
import './styles/timecard.css';
import './styles/records.css';
import './styles/home.css';
import './styles/jar.css';
import './styles/statement.css';
import './styles/attendance.css';
import './styles/receipt.css';
import './styles/safety.css';
import './styles/heat.css';
import './styles/notifications.css';
import './styles/login.css';
import './styles/voice.css';
import './styles/dispute.css';
import './styles/console.css';
// Materials last: glass.css applies them to surfaces defined above.
import './styles/glass.css';
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
