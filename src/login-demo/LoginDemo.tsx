import { useState } from 'react';
import { ArrowRight, Fingerprint, ShieldCheck } from 'lucide-react';
import { ThreadField } from './ThreadField';
import './login-demo.css';

/** Original ThreadLoginConcept, with only the explicitly approved mark/pill removals. */
export function LoginDemo() {
  const [staySignedIn, setStaySignedIn] = useState(false);
  return <main className="login-demo-page">
    <section className="thread-login login-demo-device" aria-label="Border Ledger login concept">
      <ThreadField />
      <div className="thread-grain" aria-hidden="true" />
      <div className="thread-status" aria-hidden="true"><span>9:41</span><span>●● ▰</span></div>
      <header className="thread-brand"><span>Border Ledger</span></header>
      <div className="thread-copy"><p>Personal finance, composed.</p><h2>See the flow.<br />Keep the perspective.</h2></div>
      <div className="thread-card-wrap"><form className="thread-card" onSubmit={event => event.preventDefault()}>
        <header className="thread-card-header"><h3>Welcome back</h3><p>Continue in your verified browser.</p><span className="thread-passkey">Passkey ready</span></header>
        <div className="thread-card-content"><button className="thread-sign-in" type="submit"><Fingerprint aria-hidden="true" /><span>Sign in securely</span><ArrowRight aria-hidden="true" /></button>
          <label className="thread-remember"><input type="checkbox" checked={staySignedIn} onChange={event => setStaySignedIn(event.target.checked)} /><span>Stay signed in <small>Only on this device.</small></span></label>
        </div>
        <div className="thread-separator" />
        <footer className="thread-card-footer"><ShieldCheck aria-hidden="true" /><span>Bank passwords never enter Border Ledger.</span></footer>
      </form></div>
      <div className="thread-homebar" aria-hidden="true" />
    </section>
  </main>;
}
