import { buildWhatsAppUrl } from './format';

const TOKEN_STORAGE_KEY = 'elan_auth_token';
const WINDOW_NAME_PREFIX = '__elan_session__:';

/**
 * Storage token multi-livello:
 * 1) Variabile in memoria JS (funziona SEMPRE, anche in iframe sandboxati con cookie e localStorage bloccati)
 * 2) sessionStorage + localStorage (persistenza in PWA standalone e tab standard)
 * 3) window.name (sopravvive al refresh anche quando lo storage di terze parti è bloccato)
 */
let memoryToken: string | null = null;
let storageHydrated = false;

function hydrateTokenFromBrowser(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const fromLocal = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (fromLocal) return fromLocal;
  } catch {
    // localStorage bloccato in iframe di terze parti
  }

  try {
    const fromSession = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (fromSession) return fromSession;
  } catch {
    // sessionStorage bloccato in iframe di terze parti
  }

  try {
    if (typeof window.name === 'string' && window.name.startsWith(WINDOW_NAME_PREFIX)) {
      const fromName = window.name.slice(WINDOW_NAME_PREFIX.length).trim();
      if (fromName) return fromName;
    }
  } catch {
    // ignore
  }

  return null;
}

export function getStoredToken(): string | null {
  if (memoryToken) return memoryToken;
  if (!storageHydrated) {
    storageHydrated = true;
    memoryToken = hydrateTokenFromBrowser();
  }
  return memoryToken;
}

export function setStoredToken(token: string | null): void {
  const clean = token && token.trim() ? token.trim() : null;
  memoryToken = clean;
  storageHydrated = true;

  if (typeof window === 'undefined') return;

  try {
    if (clean) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, clean);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction
  }

  try {
    if (clean) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, clean);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction
  }

  try {
    if (clean) {
      window.name = `${WINDOW_NAME_PREFIX}${clean}`;
    } else if (typeof window.name === 'string' && window.name.startsWith(WINDOW_NAME_PREFIX)) {
      window.name = '';
    }
  } catch {
    // ignore
  }
}

export class ApiClientError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function attachAuthHeaders(headers: Headers): string | null {
  const token = getStoredToken();
  if (token) {
    // Header dedicato X-Elan-Token (mai alterato da reverse proxy) + standard Authorization Bearer
    if (!headers.has('X-Elan-Token')) {
      headers.set('X-Elan-Token', token);
    }
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  return token;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = attachAuthHeaders(headers);

  // In anteprima iframe cross-site aggiunge anche fallback query nel caso cookie/header siano filtrati
  const shouldAttachQueryFallback =
    Boolean(token) && isRunningInIframe() && !path.startsWith('/api/auth/login') && !path.startsWith('/api/public/');
  const targetUrl =
    shouldAttachQueryFallback && token
      ? `${path}${path.includes('?') ? '&' : '?'}_token=${encodeURIComponent(token)}`
      : path;

  const res = await fetch(targetUrl, {
    ...options,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });

  if (!res.ok) {
    let errMsg = `Errore richiesta (${res.status})`;
    let errCode: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) errMsg = body.error;
      if (body?.code) errCode = body.code;
    } catch {
      // ignore non-json body
    }
    throw new ApiClientError(errMsg, res.status, errCode);
  }

  return (await res.json()) as T;
}

/**
 * Scarica un file protetto da autenticazione (CSV / Excel / JSON / SQL) funzionando anche in iframe.
 */
export async function downloadAuthenticatedFile(
  url: string,
  fallbackFilename: string
): Promise<void> {
  const headers = new Headers();
  const token = attachAuthHeaders(headers);
  const fullUrl = token
    ? `${url}${url.includes('?') ? '&' : '?'}_token=${encodeURIComponent(token)}`
    : url;

  const res = await fetch(fullUrl, {
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error('Impossibile scaricare il file richiesto.');
  }

  const disp = res.headers.get('Content-Disposition') || '';
  const match = disp.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

/**
 * Copia testo negli appunti con fallback automatico per iframe con Clipboard API limitata.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function isRunningInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export interface WhatsAppLaunchRequest {
  phone?: string;
  recipientName: string;
  contextLabel?: string;
  message: string;
  onMarkedSent?: () => void;
}

type WhatsAppModalListener = (req: WhatsAppLaunchRequest) => void;
let whatsAppModalListener: WhatsAppModalListener | null = null;

export function registerWhatsAppModalListener(listener: WhatsAppModalListener | null): void {
  whatsAppModalListener = listener;
}

/**
 * Apre WhatsApp in 1 clic su smartphone/desktop standalone (SRS 4.2),
 * mentre in anteprima iframe (o se il browser blocca popup esterni) apre il compositore
 * interattivo con messaggio pre-compilato, copia rapida e link diretto wa.me.
 */
export function launchWhatsApp(req: WhatsAppLaunchRequest): void {
  const url = req.phone
    ? buildWhatsAppUrl(req.phone, req.message)
    : `https://wa.me/?text=${encodeURIComponent(req.message)}`;

  if (!isRunningInIframe()) {
    try {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (opened) {
        req.onMarkedSent?.();
        return;
      }
    } catch {
      // fallback al modale
    }
  }

  if (whatsAppModalListener) {
    whatsAppModalListener(req);
  }
}
