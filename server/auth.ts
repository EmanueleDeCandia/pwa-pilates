import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb, getSecrets } from './db.js';
import type { AuthUser, UserRole } from '../shared/types.js';

export const AUTH_COOKIE_NAME = 'elan_session';
export const CUSTOM_AUTH_HEADER = 'x-elan-token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 giorni

export interface JwtPayload {
  sub: string;
  role: UserRole;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authToken?: string;
    }
  }
}

export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export function normalizeE164Phone(raw: string): string {
  const cleaned = raw.replace(/[\s().-]/g, '');
  if (cleaned.startsWith('00')) {
    return '+' + cleaned.slice(2);
  }
  if (!cleaned.startsWith('+') && /^3\d{8,9}$/.test(cleaned)) {
    // Numero cellulare italiano senza prefisso -> aggiunge +39
    return '+39' + cleaned;
  }
  return cleaned;
}

export function isValidE164Phone(phone: string): boolean {
  return E164_PHONE_REGEX.test(phone);
}

export function signAuthToken(user: Pick<AuthUser, 'id' | 'role' | 'email'>): string {
  const { jwtSecret } = getSecrets();
  const payload: JwtPayload = { sub: user.id, role: user.role, email: user.email };
  return jwt.sign(payload, jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyAuthToken(token: string): AuthUser | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const { jwtSecret } = getSecrets();
    const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, role, full_name, email, phone, color, push_subscription, google_calendar_token
         FROM users WHERE id = ?`
      )
      .get(decoded.sub) as
      | {
          id: string;
          role: UserRole;
          full_name: string;
          email: string;
          phone: string;
          color: string;
          push_subscription: string | null;
          google_calendar_token: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      role: row.role,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      color: row.color,
      has_push_subscription: Boolean(row.push_subscription),
      google_calendar_token: row.google_calendar_token,
    };
  } catch {
    return null;
  }
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return proto === 'https';
}

/**
 * Imposta il cookie di sessione HttpOnly compatibile sia con PWA standalone/desktop
 * sia con anteprime cross-site in iframe HTTPS (SameSite=None; Secure; Partitioned / CHIPS).
 */
export function setAuthCookie(res: Response, token: string, req: Request): void {
  const https = isHttpsRequest(req);
  if (https) {
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      partitioned: true,
      maxAge: TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });
  } else {
    res.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });
  }
}

export function clearAuthCookie(res: Response, req?: Request): void {
  const https = req ? isHttpsRequest(req) : false;
  if (https) {
    res.clearCookie(AUTH_COOKIE_NAME, {
      path: '/',
      sameSite: 'none',
      secure: true,
      partitioned: true,
    });
  }
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
}

/**
 * Raccoglie tutti i token candidati presenti nella richiesta (header dedicato X-Elan-Token,
 * Authorization Bearer, query _token per download/iframe, e cookie HttpOnly).
 * Verificare ogni candidato singolarmente evita falsi 401 se un proxy sovrascrive Authorization
 * o se è rimasto un vecchio cookie scaduto accanto a un nuovo token valido.
 */
export function extractCandidateTokens(req: Request): string[] {
  const candidates: string[] = [];

  const customHeader = req.headers[CUSTOM_AUTH_HEADER];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    candidates.push(customHeader.trim());
  } else if (Array.isArray(customHeader) && customHeader[0]?.trim()) {
    candidates.push(customHeader[0].trim());
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) candidates.push(bearer);
  }

  const queryToken = req.query?._token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    candidates.push(queryToken.trim());
  }

  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    candidates.push(cookieToken.trim());
  }

  return Array.from(new Set(candidates));
}

export function extractTokensFromCookieHeader(cookieHeader?: string): string[] {
  if (!cookieHeader) return [];
  const results: string[] = [];
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key === AUTH_COOKIE_NAME && val) {
      try {
        results.push(decodeURIComponent(val));
      } catch {
        results.push(val);
      }
    }
  }
  return results;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const candidates = extractCandidateTokens(req);
  if (candidates.length === 0) {
    res.status(401).json({ error: 'Autenticazione richiesta.', code: 'AUTH_REQUIRED' });
    return;
  }

  for (const candidate of candidates) {
    const user = verifyAuthToken(candidate);
    if (user) {
      req.user = user;
      req.authToken = candidate;
      next();
      return;
    }
  }

  clearAuthCookie(res, req);
  res.status(401).json({ error: 'Sessione scaduta o non valida.', code: 'AUTH_INVALID' });
}

/**
 * Policy RLS lato endpoint: blocca qualsiasi accesso STAFF a entità economiche o amministrative.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Autenticazione richiesta.', code: 'AUTH_REQUIRED' });
    return;
  }
  if (req.user.role !== 'ADMIN') {
    res.status(403).json({
      error:
        'RLS_FORBIDDEN: Accesso riservato alla Titolare. I dati economici e amministrativi non sono accessibili al ruolo Insegnante.',
      code: 'RLS_FORBIDDEN',
    });
    return;
  }
  next();
}
