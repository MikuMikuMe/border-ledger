import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LoginDemo } from './login-demo/LoginDemo';
import './styles.css';

const location = new URL(window.location.href);
const initialRoute = location.pathname === '/'
  ? 'landing'
  : location.pathname === '/mobile/authorize'
    ? 'mobile-authorization'
    : 'workspace';

const content = location.pathname === '/login-demo'
  ? <LoginDemo />
  : <App
      initialRoute={initialRoute}
      authorizationRequestId={location.searchParams.get('request_id')}
      authorizationState={location.searchParams.get('state')}
    />;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {content}
  </React.StrictMode>,
);
