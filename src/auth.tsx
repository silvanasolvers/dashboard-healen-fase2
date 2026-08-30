import { FormEvent, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LogIn } from 'lucide-react';
import { clearCrmCache, setCrmCacheScope } from './api';
import { supabase } from './supabase';

/** Estado de sesión reactivo. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      clearCrmCache();
      setCrmCacheScope(data.session?.user.id ?? null);
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      // También limpia en refresh/revocación de sesión. La UI conserva su
      // propio estado mientras está montada, pero el caché compartido no.
      clearCrmCache();
      setCrmCacheScope(s?.user.id ?? null);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    session,
    loading,
    signOut: () => {
      clearCrmCache();
      setCrmCacheScope(null);
      return supabase.auth.signOut();
    },
  };
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('Correo o contraseña incorrectos.');
      setBusy(false);
    }
    // En éxito, el listener de sesión re-renderiza la app.
  }

  return (
    <div className="login">
      <div className="login__panel">
        <span className="brandmark login__mark">
          <img src="/healen-logo.png" alt="Healen" />
        </span>
        <div className="login__lead">
          <span className="eyebrow">Healen OS</span>
          <h1>Bienvenido de vuelta</h1>
          <p>Ingresa para ver pacientes, inventario y caja en tiempo real.</p>
        </div>
        <form className="login__form" onSubmit={submit}>
          <label className="field">
            <span>Correo</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label className="field">
            <span>Contraseña</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" required />
          </label>
          {error && <p className="login__error">{error}</p>}
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            <LogIn size={18} />
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
