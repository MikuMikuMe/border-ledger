import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

const location = new URL(window.location.href);
const initialRoute = location.pathname === '/'
  ? 'landing'
  : location.pathname === '/mobile/authorize'
    ? 'mobile-authorization'
    : 'workspace';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App
      initialRoute={initialRoute}
      authorizationRequestId={location.searchParams.get('request_id')}
      authorizationState={location.searchParams.get('state')}
    />
  </React.StrictMode>,
);
