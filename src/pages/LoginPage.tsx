import React, { useState } from 'react';
import {
  ArrowRight,
  Calendar,
  Database,
  KeyRound,
  Mail,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { apiFetch, setStoredToken } from '../lib/api';
import type { AuthUser } from '../../shared/types';

interface LoginPageProps {
  onAuthenticated: (user: AuthUser) => void;
  onOpenPublicBoard: () => void;
}

const DEMO_PROFILES = [
  {
    label: 'Elena Rossi',
    roleBadge: 'Titolare · Admin',
    detail: 'Dashboard KPI, calendario sale, pacchetti, pagamenti, WhatsApp e audit',
    email: 'elena.rossi@atelierpilates.it',
    password: 'Admin2026!',
    accent: '#4A6759',
  },
  {
    label: 'Giulia Ferretti',
    roleBadge: 'Insegnante · Staff',
    detail: 'Agenda Reformer & Posturale, appello in 2 tocchi (zero dati economici)',
    email: 'giulia.ferretti@atelierpilates.it',
    password: 'Staff2026!',
    accent: '#4A6759',
  },
  {
    label: 'Camilla Conti',
    roleBadge: 'Insegnante · Staff',
    detail: 'Agenda Matwork & Sbarra, alert anti-dimenticanza e sync calendario',
    email: 'camilla.conti@atelierpilates.it',
    password: 'Staff2026!',
    accent: '#B86B52',
  },
];

export function LoginPage({ onAuthenticated, onOpenPublicBoard }: LoginPageProps) {
  const [mode, setMode] = useState<'password' | 'magic'>('password');
  const [email, setEmail] = useState('elena.rossi@atelierpilates.it');
  const [password, setPassword] = useState('Admin2026!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicResult, setMagicResult] = useState<{
    message: string;
    magic_path: string;
  } | null>(null);

  const performLogin = async (targetEmail: string, targetPassword: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail, password: targetPassword }),
      });
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore di accesso.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'password') {
      await performLogin(email, password);
      return;
    }

    setError(null);
    setMagicResult(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ message: string; magic_path: string }>(
        '/api/auth/magic-link',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        }
      );
      setMagicResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile generare il Magic Link.');
    } finally {
      setLoading(false);
    }
  };

  const handleUseMagicLink = async (magicPath: string) => {
    const url = new URL(magicPath, window.location.origin);
    const token = url.searchParams.get('magic');
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/magic-verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Magic Link non valido.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#F8F6F2] flex flex-col lg:flex-row">
      {/* Colonna editoriale Pilates (sinistra su desktop, header compatto su mobile) */}
      <aside className="relative lg:w-[44%] xl:w-[42%] bg-[#4A6759] text-[#F8F6F2] px-6 py-8 sm:px-10 lg:p-12 flex flex-col justify-between overflow-hidden">
        {/* Cerchi organici decorativi ispirati al respiro e al movimento */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-28 h-96 w-96 rounded-full border border-[#F8F6F2]/12"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -bottom-24 h-80 w-80 rounded-full bg-[#3A5347]/50"
        />

        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark size={42} variant="linen" />
            <div>
              <p className="font-display text-2xl font-semibold tracking-wide leading-none">
                Atelier Élan
              </p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#DCE5DF] mt-1">
                Pilates &amp; Danza Sportiva
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenPublicBoard}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#F8F6F2]/25 bg-[#F8F6F2]/10 px-3.5 py-1.5 text-xs font-medium text-[#F8F6F2] hover:bg-[#F8F6F2]/20 transition-colors"
          >
            <Calendar className="h-3.5 w-3.5" />
            Bacheca Corsi
          </button>
        </div>

        <div className="relative z-10 my-8 lg:my-0 max-w-md">
          <p className="text-xs uppercase tracking-[0.2em] text-[#E5C9B8] mb-3">
            Gestionale Operativo PWA
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-medium leading-[1.08] text-[#F8F6F2]">
            Equilibrio, controllo e armonia nella gestione dello studio.
          </h1>
          <p className="mt-4 text-sm sm:text-base text-[#DCE5DF] leading-relaxed">
            Calendario Reformer e Matwork senza sovrapposizioni, appello insegnanti in due
            tocchi, pacchetti lezioni e promemoria WhatsApp immediati.
          </p>

          <div className="hidden sm:grid grid-cols-2 gap-3 mt-8 pt-6 border-t border-[#F8F6F2]/15 text-xs text-[#E4ECE7]">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-[#E5C9B8] shrink-0 mt-0.5" />
              <span>Ruoli separati con protezione RLS sui dati economici</span>
            </div>
            <div className="flex items-start gap-2.5">
              <Database className="h-4 w-4 text-[#E5C9B8] shrink-0 mt-0.5" />
              <span>Database SQLite locale attivo per test pre-produzione</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 hidden lg:flex items-center justify-between text-xs text-[#CBD7CF]">
          <span>Sala 1 Reformer · Sala 2 Matwork</span>
          <button
            type="button"
            onClick={onOpenPublicBoard}
            className="inline-flex items-center gap-1 text-[#F8F6F2] underline underline-offset-4 hover:text-[#E5C9B8] transition-colors"
          >
            Apri Bacheca Pubblica (Zero-Login)
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </aside>

      {/* Colonna accesso (destra) */}
      <main className="flex-1 flex items-center justify-center px-5 py-8 sm:px-10 lg:p-12">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="font-display text-3xl font-semibold text-[#23201D]">
              Accesso Riservato
            </h2>
            <p className="mt-1 text-sm text-[#625B52]">
              Accedi come Titolare o Insegnante. Gli studenti ricevono comunicazioni dirette su
              WhatsApp senza bisogno di account.
            </p>
          </div>

          {/* Selettore modalità Email+Password / Magic Link Insegnanti */}
          <div className="grid grid-cols-2 rounded-xl bg-[#EFEAE1] p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setMode('password');
                setMagicResult(null);
                setError(null);
              }}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 transition-all ${
                mode === 'password'
                  ? 'bg-white text-[#23201D] shadow-xs'
                  : 'text-[#625B52] hover:text-[#23201D]'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Email e Password
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('magic');
                setError(null);
                if (email === 'elena.rossi@atelierpilates.it') {
                  setEmail('giulia.ferretti@atelierpilates.it');
                }
              }}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 transition-all ${
                mode === 'magic'
                  ? 'bg-white text-[#23201D] shadow-xs'
                  : 'text-[#625B52] hover:text-[#23201D]'
              }`}
            >
              <Wand2 className="h-3.5 w-3.5" />
              Magic Link Staff
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-white border border-[#E8E2D9] p-6 shadow-xs space-y-4"
          >
            {error && (
              <div className="rounded-xl border border-[#EBC3C0] bg-[#FBECEB] px-3.5 py-2.5 text-xs text-[#A63A31]">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-medium text-[#625B52] mb-1.5"
              >
                Indirizzo Email
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-[#8E867B] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@atelierpilates.it"
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] pl-10 pr-3.5 py-2.5 text-sm text-[#23201D] focus:border-[#4A6759] focus:bg-white focus:outline-none transition-colors"
                />
              </div>
            </div>

            {mode === 'password' && (
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-[#625B52] mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <KeyRound className="h-4 w-4 text-[#8E867B] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] pl-10 pr-3.5 py-2.5 text-sm text-[#23201D] focus:border-[#4A6759] focus:bg-white focus:outline-none transition-colors"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#4A6759] px-4 py-3 text-sm font-semibold text-white hover:bg-[#3A5347] transition-colors disabled:opacity-50"
            >
              {loading
                ? 'Accesso in corso...'
                : mode === 'password'
                  ? 'Entra nello Studio'
                  : 'Genera Magic Link Rapido'}
              <ArrowRight className="h-4 w-4" />
            </button>

            {magicResult && (
              <div className="rounded-xl border border-[#C9DBD0] bg-[#EDF2EE] p-3.5 space-y-2">
                <p className="text-xs text-[#2F6649] font-medium">{magicResult.message}</p>
                <p className="text-[11px] text-[#4A6759]">
                  Ambiente di prova locale: clicca qui sotto per simulare l&apos;apertura del link
                  ricevuto via email.
                </p>
                <button
                  type="button"
                  onClick={() => handleUseMagicLink(magicResult.magic_path)}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2F6649] px-3 py-2 text-xs font-semibold text-white hover:bg-[#24523A]"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Accedi subito con Magic Link
                </button>
              </div>
            )}
          </form>

          {/* Profili Demo Pre-Produzione (1-Click per testare subito tutti i ruoli SRS) */}
          <div className="rounded-2xl border border-[#E8E2D9] bg-[#F3EFE7]/75 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#625B52]">
                Prova Rapida Ruoli (DB Locale)
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white border border-[#E2DACD] px-2 py-0.5 text-[10px] font-medium text-[#4A6759]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3D7A5A]" />
                SQLite attivo
              </span>
            </div>

            <div className="space-y-2">
              {DEMO_PROFILES.map((prof) => (
                <button
                  key={prof.email}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setEmail(prof.email);
                    setPassword(prof.password);
                    performLogin(prof.email, prof.password);
                  }}
                  className="w-full text-left rounded-xl bg-white border border-[#E8E2D9] px-3.5 py-2.5 hover:border-[#4A6759] hover:shadow-xs transition-all group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: prof.accent }}
                      />
                      <span className="text-sm font-semibold text-[#23201D] group-hover:text-[#4A6759] transition-colors">
                        {prof.label}
                      </span>
                    </div>
                    <span className="rounded-full bg-[#F4F0E8] px-2.5 py-0.5 text-[11px] font-medium text-[#625B52]">
                      {prof.roleBadge}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#8E867B] pl-4.5 leading-snug">{prof.detail}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
