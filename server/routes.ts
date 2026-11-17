import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { getDb, recordAuditLog, runInTransaction } from './db.js';
import {
  clearAuthCookie,
  isValidE164Phone,
  normalizeE164Phone,
  requireAdmin,
  requireAuth,
  setAuthCookie,
  signAuthToken,
} from './auth.js';
import { broadcastSync } from './realtime.js';
import { dispatchTeacherNotification, initVapidKeys } from './push.js';
import { seedDatabase, DEMO_ACCOUNTS } from './seed.js';
import {
  AppError,
  assertNoLessonConflicts,
  buildAdminDashboard,
  buildCsvString,
  buildExcelWorkbookXml,
  computeFreeSlots,
  generateTeacherIcsFeed,
  getExportDatasets,
  getStudioSettings,
  queryAuditLogs,
  queryBookingsForLesson,
  queryLessonSlots,
  queryPackagesWithStats,
  queryPublicTargetedCourses,
  refreshPackageStatus,
  rescheduleBookingToSlot,
  translateSqliteError,
  unlockLessonRollCall,
  updateBookingAttendance,
  validateLessonRollCall,
} from './services.js';
import type { AttendanceStatus, PaymentStatus, PackageStatus } from '../shared/types.js';

function paramStr(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] || '' : String(v || '');
}

function handleError(res: Response, err: unknown): void {
  const appErr = translateSqliteError(err);
  res.status(appErr.status).json({ error: appErr.message, code: appErr.code });
}

export function createApiRouter(): Router {
  const router = Router();

  // Impedisce qualsiasi caching intermedio/browser sulle risposte API autenticate
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // ===========================================================================
  // ENDPOINT PUBBLICI (Zero-Login)
  // ===========================================================================

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      database: 'sqlite-local',
      timestamp: new Date().toISOString(),
    });
  });

  // SRS 4.1: Bacheca Disponibilità Pubblica (Corsi Mirati + Posti Residui + WhatsApp Titolare)
  router.get('/public/availability', (_req, res) => {
    try {
      const data = queryPublicTargetedCourses(getDb());
      res.json(data);
    } catch (err) {
      handleError(res, err);
    }
  });

  // SRS 1 & 4.1: Richiesta Posto / Lista d'Attesa Zero-Login dalla Bacheca Pubblica
  router.post('/public/inquiries', (req: Request, res: Response) => {
    try {
      const firstName = String(req.body?.first_name || '').trim();
      const lastName = String(req.body?.last_name || '').trim();
      const phone = normalizeE164Phone(String(req.body?.phone || ''));
      const notes = String(req.body?.notes || '').trim().slice(0, 500);
      const lessonSlotId = req.body?.lesson_slot_id ? String(req.body.lesson_slot_id).trim() : null;

      if (!firstName || !lastName) {
        throw new AppError(400, 'MISSING_NAME', 'Inserisci nome e cognome per richiedere il posto.');
      }
      if (!isValidE164Phone(phone)) {
        throw new AppError(
          400,
          'INVALID_PHONE',
          'Inserisci un numero WhatsApp valido (es. +393401234567 oppure 3401234567).'
        );
      }

      const db = getDb();
      let slotTitle: string | null = null;
      if (lessonSlotId) {
        const slot = db
          .prepare('SELECT id, title FROM lesson_slots WHERE id = ?')
          .get(lessonSlotId) as { id: string; title: string } | undefined;
        if (!slot) {
          throw new AppError(404, 'SLOT_NOT_FOUND', 'Il corso selezionato non è più disponibile.');
        }
        slotTitle = slot.title;
      }

      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO public_inquiries (id, lesson_slot_id, first_name, last_name, phone, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'NEW')`
      ).run(id, lessonSlotId, firstName, lastName, phone, notes);

      broadcastSync('inquiries', 'created', {
        lessonSlotId: lessonSlotId || undefined,
        adminOnlyMessage: `Nuova richiesta posto da ${firstName} ${lastName}${
          slotTitle ? ` per "${slotTitle}"` : ''
        }.`,
      });

      res.status(201).json({
        id,
        message:
          'Richiesta registrata in segreteria! La Titolare ti contatterà su WhatsApp per la conferma del posto.',
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // SRS 4.3: Feed dinamico .ics per Google Calendar con alert nativi -60m e +15m
  router.get('/calendar/:token/feed.ics', (req, res) => {
    try {
      const ics = generateTeacherIcsFeed(getDb(), paramStr(req.params.token));
      if (!ics) {
        res.status(404).send('Calendario non trovato o token revocato.');
        return;
      }
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="turni-pilates.ics"');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(ics);
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // AUTENTICAZIONE (Email + Password e Magic Link per Insegnanti — SRS 1)
  // ===========================================================================

  router.post('/auth/login', (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!email || !password) {
        throw new AppError(400, 'MISSING_CREDENTIALS', 'Inserisci email e password.');
      }

      const db = getDb();
      const user = db
        .prepare(
          `SELECT id, role, full_name, email, password_hash, phone, color, push_subscription, google_calendar_token
           FROM users WHERE lower(email) = ?`
        )
        .get(email) as
        | {
            id: string;
            role: 'ADMIN' | 'STAFF';
            full_name: string;
            email: string;
            password_hash: string;
            phone: string;
            color: string;
            push_subscription: string | null;
            google_calendar_token: string | null;
          }
        | undefined;

      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenziali non valide.');
      }

      const token = signAuthToken(user);
      setAuthCookie(res, token, req);

      res.json({
        token,
        user: {
          id: user.id,
          role: user.role,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          color: user.color,
          has_push_subscription: Boolean(user.push_subscription),
          google_calendar_token: user.google_calendar_token,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/auth/magic-link', (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!email) {
        throw new AppError(400, 'MISSING_EMAIL', "Inserisci l'indirizzo email dell'insegnante.");
      }

      const db = getDb();
      const user = db
        .prepare('SELECT id, full_name, email FROM users WHERE lower(email) = ?')
        .get(email) as { id: string; full_name: string; email: string } | undefined;

      if (!user) {
        throw new AppError(404, 'USER_NOT_FOUND', 'Nessun profilo trovato per questa email.');
      }

      const rawToken = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      db.prepare(
        `INSERT INTO magic_links (token, user_id, expires_at) VALUES (?, ?, ?)`
      ).run(rawToken, user.id, expiresAt);

      // In modalità pre-produzione locale restituisce il link pronto per il test immediato
      res.json({
        message: `Magic Link generato per ${user.full_name} (valido 30 minuti).`,
        magic_path: `/?magic=${rawToken}`,
        expires_at: expiresAt,
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/auth/magic-verify', (req: Request, res: Response) => {
    try {
      const magicToken = String(req.body?.token || '').trim();
      if (!magicToken) {
        throw new AppError(400, 'INVALID_TOKEN', 'Token Magic Link mancante.');
      }

      const db = getDb();
      const link = db
        .prepare('SELECT token, user_id, expires_at, used_at FROM magic_links WHERE token = ?')
        .get(magicToken) as
        | { token: string; user_id: string; expires_at: string; used_at: string | null }
        | undefined;

      if (!link || link.used_at || new Date(link.expires_at).getTime() < Date.now()) {
        throw new AppError(401, 'EXPIRED_MAGIC_LINK', 'Il Magic Link è scaduto o già utilizzato.');
      }

      db.prepare('UPDATE magic_links SET used_at = ? WHERE token = ?').run(
        new Date().toISOString(),
        magicToken
      );

      const user = db
        .prepare(
          `SELECT id, role, full_name, email, phone, color, push_subscription, google_calendar_token
           FROM users WHERE id = ?`
        )
        .get(link.user_id) as {
        id: string;
        role: 'ADMIN' | 'STAFF';
        full_name: string;
        email: string;
        phone: string;
        color: string;
        push_subscription: string | null;
        google_calendar_token: string | null;
      };

      const jwtToken = signAuthToken(user);
      setAuthCookie(res, jwtToken, req);

      res.json({
        token: jwtToken,
        user: {
          id: user.id,
          role: user.role,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          color: user.color,
          has_push_subscription: Boolean(user.push_subscription),
          google_calendar_token: user.google_calendar_token,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/auth/logout', (req, res) => {
    clearAuthCookie(res, req);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user, token: req.authToken });
  });

  // ===========================================================================
  // RICHIESTE POSTO DALLA BACHECA PUBBLICA (Solo ADMIN — SRS 4.1 & 4.2)
  // ===========================================================================

  router.get('/inquiries', requireAuth, requireAdmin, (req, res) => {
    try {
      const onlyNew = req.query.status === 'NEW';
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT
             pi.id,
             pi.lesson_slot_id,
             ls.title AS lesson_title,
             ls.start_time AS lesson_start_time,
             ls.end_time AS lesson_end_time,
             r.name AS room_name,
             pi.first_name,
             pi.last_name,
             pi.phone,
             pi.notes,
             pi.status,
             pi.created_at
           FROM public_inquiries pi
           LEFT JOIN lesson_slots ls ON ls.id = pi.lesson_slot_id
           LEFT JOIN rooms r ON r.id = ls.room_id
           ${onlyNew ? "WHERE pi.status = 'NEW'" : ''}
           ORDER BY CASE pi.status WHEN 'NEW' THEN 0 ELSE 1 END, pi.created_at DESC
           LIMIT 100`
        )
        .all();
      res.json({ inquiries: rows });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.patch('/inquiries/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const id = paramStr(req.params.id);
      const status = req.body?.status === 'NEW' ? 'NEW' : 'HANDLED';
      const enroll = Boolean(req.body?.enroll);
      const db = getDb();

      const inquiry = db
        .prepare(
          `SELECT id, lesson_slot_id, first_name, last_name, phone, notes
           FROM public_inquiries WHERE id = ?`
        )
        .get(id) as
        | {
            id: string;
            lesson_slot_id: string | null;
            first_name: string;
            last_name: string;
            phone: string;
            notes: string;
          }
        | undefined;
      if (!inquiry) {
        throw new AppError(404, 'INQUIRY_NOT_FOUND', 'Richiesta non trovata.');
      }

      let enrolledMessage: string | undefined;

      if (enroll && inquiry.lesson_slot_id) {
        runInTransaction(db, () => {
          // Cerca allievo per telefono (o lo registra in anagrafica)
          let student = db
            .prepare('SELECT id, first_name, last_name FROM students WHERE phone = ?')
            .get(inquiry.phone) as
            | { id: string; first_name: string; last_name: string }
            | undefined;

          if (!student) {
            const newStudentId = crypto.randomUUID();
            db.prepare(
              `INSERT INTO students (id, first_name, last_name, phone, medical_notes)
               VALUES (?, ?, ?, ?, ?)`
            ).run(newStudentId, inquiry.first_name, inquiry.last_name, inquiry.phone, inquiry.notes);
            student = {
              id: newStudentId,
              first_name: inquiry.first_name,
              last_name: inquiry.last_name,
            };
          }

          // Cerca pacchetto attivo con crediti; se nuovo allievo crea ingresso singolo da saldare
          let pkg = db
            .prepare(
              `SELECT id FROM packages
               WHERE student_id = ? AND status = 'ACTIVE' AND (total_credits - used_credits) > 0
               ORDER BY purchase_date ASC LIMIT 1`
            )
            .get(student.id) as { id: string } | undefined;

          let createdSingleEntry = false;
          if (!pkg) {
            const newPkgId = crypto.randomUUID();
            const today = new Date().toISOString().slice(0, 10);
            db.prepare(
              `INSERT INTO packages
                (id, student_id, name, total_credits, used_credits, frozen_credits, price, payment_status, amount_paid, purchase_date, status)
               VALUES (?, ?, 'Ingresso Corso Mirato (1 Lezione)', 1, 0, 0, 28, 'UNPAID', 0, ?, 'ACTIVE')`
            ).run(newPkgId, student.id, today);
            pkg = { id: newPkgId };
            createdSingleEntry = true;
          }

          // Verifica non già iscritto
          const existing = db
            .prepare('SELECT id FROM bookings WHERE lesson_slot_id = ? AND student_id = ?')
            .get(inquiry.lesson_slot_id, student.id) as { id: string } | undefined;
          if (!existing) {
            db.prepare(
              `INSERT INTO bookings (id, lesson_slot_id, student_id, package_id, attendance_status)
               VALUES (?, ?, ?, ?, 'PENDING')`
            ).run(crypto.randomUUID(), inquiry.lesson_slot_id, student.id, pkg.id);
          }

          db.prepare("UPDATE public_inquiries SET status = 'HANDLED' WHERE id = ?").run(id);
          recordAuditLog(db, req.user!.id, 'BOOKING_ADDED', inquiry.lesson_slot_id!, {
            student_name: `${student.first_name} ${student.last_name}`,
            source: 'public_board',
            created_single_entry: createdSingleEntry,
          });

          enrolledMessage = createdSingleEntry
            ? `${student.first_name} ${student.last_name} registrato/a e iscritto/a al corso (creato Ingresso Corso Mirato da saldare).`
            : `${student.first_name} ${student.last_name} iscritto/a al corso utilizzando il suo pacchetto attivo.`;
        });

        broadcastSync('bookings', 'created', {
          lessonSlotId: inquiry.lesson_slot_id,
          staffSafeMessage: 'Nuovo partecipante assegnato al corso.',
        });
      } else {
        db.prepare('UPDATE public_inquiries SET status = ? WHERE id = ?').run(status, id);
      }

      broadcastSync('inquiries', 'updated');
      res.json({ ok: true, message: enrolledMessage });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // WEB PUSH NOTIFICATIONS & SYNC CALENDARIO (SRS 4.3 & 5)
  // ===========================================================================

  router.get('/push/vapid-public-key', requireAuth, (_req, res) => {
    const { publicKey } = initVapidKeys();
    res.json({ publicKey });
  });

  router.post('/push/subscribe', requireAuth, (req, res) => {
    try {
      const subscription = req.body?.subscription;
      if (!subscription || typeof subscription !== 'object') {
        throw new AppError(400, 'INVALID_SUBSCRIPTION', 'Oggetto sottoscrizione push non valido.');
      }
      getDb()
        .prepare('UPDATE users SET push_subscription = ? WHERE id = ?')
        .run(JSON.stringify(subscription), req.user!.id);
      res.json({ ok: true, has_push_subscription: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/push/subscribe', requireAuth, (req, res) => {
    getDb().prepare('UPDATE users SET push_subscription = NULL WHERE id = ?').run(req.user!.id);
    res.json({ ok: true, has_push_subscription: false });
  });

  router.post('/push/test', requireAuth, async (req, res) => {
    try {
      const result = await dispatchTeacherNotification(req.user!.id, {
        title: 'Atelier Élan — Promemoria Attivo',
        body: 'Riceverai avvisi automatici 60 min prima della lezione e 15 min dopo la fine per chiudere l’appello.',
        tag: 'test-push',
        url: '/',
      });
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/calendar/regenerate-token', requireAuth, (req, res) => {
    const newToken = `cal_${crypto.randomBytes(18).toString('hex')}`;
    getDb()
      .prepare('UPDATE users SET google_calendar_token = ? WHERE id = ?')
      .run(newToken, req.user!.id);
    res.json({ google_calendar_token: newToken });
  });

  // ===========================================================================
  // SALE (rooms — SRS 2.2)
  // ===========================================================================

  router.get('/rooms', requireAuth, (req, res) => {
    const db = getDb();
    const includeInactive = req.user!.role === 'ADMIN' && req.query.all === 'true';
    const sql = includeInactive
      ? 'SELECT * FROM rooms ORDER BY name ASC'
      : 'SELECT * FROM rooms WHERE is_active = 1 ORDER BY name ASC';
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    res.json({
      rooms: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        description: String(r.description || ''),
        default_capacity: Number(r.default_capacity),
        is_active: Boolean(r.is_active),
      })),
    });
  });

  router.post('/rooms', requireAuth, requireAdmin, (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const description = String(req.body?.description || '').trim();
      const defaultCapacity = Number(req.body?.default_capacity);
      if (!name) throw new AppError(400, 'INVALID_NAME', 'Inserisci il nome della sala.');
      if (!Number.isInteger(defaultCapacity) || defaultCapacity < 1 || defaultCapacity > 100) {
        throw new AppError(
          400,
          'INVALID_CAPACITY',
          'La capienza standard deve essere un intero tra 1 e 100.'
        );
      }

      const id = crypto.randomUUID();
      const db = getDb();
      db.prepare(
        `INSERT INTO rooms (id, name, description, default_capacity, is_active) VALUES (?, ?, ?, ?, 1)`
      ).run(id, name, description, defaultCapacity);

      recordAuditLog(db, req.user!.id, 'ROOM_CREATED', id, {
        name,
        default_capacity: defaultCapacity,
      });
      broadcastSync('rooms', 'created', { staffSafeMessage: `Nuova sala configurata: ${name}` });

      res.status(201).json({
        room: { id, name, description, default_capacity: defaultCapacity, is_active: true },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.patch('/rooms/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(paramStr(req.params.id)) as
        | Record<string, unknown>
        | undefined;
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Sala non trovata.');

      const name =
        req.body?.name !== undefined ? String(req.body.name).trim() : String(existing.name);
      const description =
        req.body?.description !== undefined
          ? String(req.body.description).trim()
          : String(existing.description || '');
      const defaultCapacity =
        req.body?.default_capacity !== undefined
          ? Number(req.body.default_capacity)
          : Number(existing.default_capacity);
      const isActive =
        req.body?.is_active !== undefined
          ? req.body.is_active
            ? 1
            : 0
          : Number(existing.is_active);

      if (!name) throw new AppError(400, 'INVALID_NAME', 'Il nome della sala non può essere vuoto.');
      if (!Number.isInteger(defaultCapacity) || defaultCapacity < 1 || defaultCapacity > 100) {
        throw new AppError(400, 'INVALID_CAPACITY', 'Capienza non valida.');
      }

      db.prepare(
        `UPDATE rooms SET name = ?, description = ?, default_capacity = ?, is_active = ? WHERE id = ?`
      ).run(name, description, defaultCapacity, isActive, paramStr(req.params.id));

      broadcastSync('rooms', 'updated');
      res.json({
        room: {
          id: paramStr(req.params.id),
          name,
          description,
          default_capacity: defaultCapacity,
          is_active: Boolean(isActive),
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // INSEGNANTI (users role=STAFF — SRS 2.1, 3.3, 4.2.3, 4.3)
  // ===========================================================================

  router.get('/teachers', requireAuth, (req, res) => {
    const db = getDb();
    if (req.user!.role === 'STAFF') {
      // RLS: STAFF vede solo nome e colore colleghi per coordinamento sale
      const list = db
        .prepare(`SELECT id, role, full_name, color FROM users WHERE role = 'STAFF' ORDER BY full_name ASC`)
        .all();
      res.json({ teachers: list });
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const tmr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const tmrStart = tmr.toISOString();
    const tmrEnd = new Date(tmr.getTime() + 86_400_000).toISOString();

    const users = db
      .prepare(
        `SELECT id, role, full_name, email, phone, color, push_subscription
         FROM users WHERE role = 'STAFF' ORDER BY full_name ASC`
      )
      .all() as Record<string, unknown>[];

    const teachers = users.map((u) => {
      const id = String(u.id);
      const mSlots = db
        .prepare(
          `SELECT start_time, end_time, is_validated FROM lesson_slots
           WHERE teacher_id = ? AND start_time >= ? AND start_time < ?`
        )
        .all(id, monthStart, monthEnd) as {
        start_time: string;
        end_time: string;
        is_validated: number;
      }[];

      let valHours = 0;
      let valCount = 0;
      let schedHours = 0;
      for (const s of mSlots) {
        const h = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3_600_000;
        schedHours += h;
        if (s.is_validated) {
          valHours += h;
          valCount += 1;
        }
      }

      const pendingRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM lesson_slots
           WHERE teacher_id = ? AND end_time <= ? AND is_validated = 0`
        )
        .get(id, nowIso) as { cnt: number };

      const tmrRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM lesson_slots
           WHERE teacher_id = ? AND start_time >= ? AND start_time < ?`
        )
        .get(id, tmrStart, tmrEnd) as { cnt: number };

      return {
        id,
        role: 'STAFF',
        full_name: String(u.full_name),
        email: String(u.email),
        phone: String(u.phone),
        color: String(u.color),
        has_push_subscription: Boolean(u.push_subscription),
        monthly_validated_hours: Math.round(valHours * 100) / 100,
        monthly_validated_lessons: valCount,
        monthly_scheduled_hours: Math.round(schedHours * 100) / 100,
        pending_validations_count: Number(pendingRow.cnt),
        upcoming_tomorrow_count: Number(tmrRow.cnt),
      };
    });

    res.json({ teachers });
  });

  // Riepilogo operativo personale Insegnante (Zero campi economici — SRS 3.3 & 4.3)
  router.get('/staff/summary', requireAuth, (req, res) => {
    const db = getDb();
    const userId = req.user!.id;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

    const unvalidatedPast = queryLessonSlots(db, req.user!, {
      teacherId: userId,
      onlyUnvalidatedPast: true,
    });

    const todayStr = now.toISOString().slice(0, 10);
    const todayAssigned = queryLessonSlots(db, req.user!, {
      teacherId: userId,
      from: `${todayStr}T00:00:00.000Z`,
      to: `${todayStr}T23:59:59.999Z`,
    });

    const monthValidated = db
      .prepare(
        `SELECT start_time, end_time FROM lesson_slots
         WHERE teacher_id = ? AND is_validated = 1 AND start_time >= ? AND start_time < ?`
      )
      .all(userId, monthStart, monthEnd) as { start_time: string; end_time: string }[];

    const validatedHours =
      Math.round(
        monthValidated.reduce(
          (acc, s) =>
            acc + (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3_600_000,
          0
        ) * 100
      ) / 100;

    res.json({
      unvalidated_past_lessons: unvalidatedPast,
      today_lessons: todayAssigned,
      monthly_validated_hours: validatedHours,
      monthly_validated_lessons: monthValidated.length,
    });
  });

  router.post('/teachers', requireAuth, requireAdmin, (req, res) => {
    try {
      const fullName = String(req.body?.full_name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const phone = normalizeE164Phone(String(req.body?.phone || ''));
      const color = String(req.body?.color || '#6E6582').trim();
      const password = String(req.body?.password || 'Staff2026!');

      if (!fullName || !email) {
        throw new AppError(400, 'INVALID_INPUT', 'Nome completo ed email sono obbligatori.');
      }
      if (!isValidE164Phone(phone)) {
        throw new AppError(
          400,
          'INVALID_PHONE',
          'Il telefono deve essere in formato internazionale E.164 (es. +393331234567).'
        );
      }
      if (password.length < 6) {
        throw new AppError(400, 'WEAK_PASSWORD', 'La password deve avere almeno 6 caratteri.');
      }

      const id = crypto.randomUUID();
      const hash = bcrypt.hashSync(password, 10);
      const calToken = `cal_${crypto.randomBytes(18).toString('hex')}`;

      const db = getDb();
      db.prepare(
        `INSERT INTO users (id, role, full_name, email, password_hash, phone, color, google_calendar_token)
         VALUES (?, 'STAFF', ?, ?, ?, ?, ?, ?)`
      ).run(id, fullName, email, hash, phone, color, calToken);

      recordAuditLog(db, req.user!.id, 'TEACHER_CREATED', id, { full_name: fullName, email });
      broadcastSync('lessons', 'teacher_created');

      res.status(201).json({
        teacher: { id, role: 'STAFF', full_name: fullName, email, phone, color },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.patch('/teachers/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const existing = db
        .prepare(`SELECT * FROM users WHERE id = ? AND role = 'STAFF'`)
        .get(paramStr(req.params.id)) as Record<string, unknown> | undefined;
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Insegnante non trovata.');

      const fullName =
        req.body?.full_name !== undefined
          ? String(req.body.full_name).trim()
          : String(existing.full_name);
      const email =
        req.body?.email !== undefined
          ? String(req.body.email).trim().toLowerCase()
          : String(existing.email);
      const phone =
        req.body?.phone !== undefined
          ? normalizeE164Phone(String(req.body.phone))
          : String(existing.phone);
      const color =
        req.body?.color !== undefined ? String(req.body.color).trim() : String(existing.color);

      if (!isValidE164Phone(phone)) {
        throw new AppError(
          400,
          'INVALID_PHONE',
          'Il telefono deve essere in formato E.164 (es. +393331234567).'
        );
      }

      db.prepare(
        `UPDATE users SET full_name = ?, email = ?, phone = ?, color = ? WHERE id = ?`
      ).run(fullName, email, phone, color, paramStr(req.params.id));

      if (req.body?.password && String(req.body.password).length >= 6) {
        const hash = bcrypt.hashSync(String(req.body.password), 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, paramStr(req.params.id));
      }

      broadcastSync('lessons', 'teacher_updated');
      res.json({ teacher: { id: paramStr(req.params.id), full_name: fullName, email, phone, color } });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // ANAGRAFICA STUDENTI (SRS 2.3 — Solo ADMIN, RLS protetto)
  // ===========================================================================

  router.get('/students', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const studentRows = db
      .prepare('SELECT * FROM students ORDER BY last_name ASC, first_name ASC')
      .all() as Record<string, unknown>[];
    const allPkgs = queryPackagesWithStats(db);

    const students = studentRows.map((s) => {
      const id = String(s.id);
      const sPkgs = allPkgs.filter((p) => p.student_id === id);

      // Pacchetti attivi con lezioni residue ordinati secondo logica FIFO (data acquisto più remota per prima)
      const activeWithCredits = sPkgs
        .filter((p) => p.status === 'ACTIVE' && p.remaining_credits > 0)
        .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));

      const currentConsumingPkg = activeWithCredits[0] ?? null;
      const queuedPkgs = activeWithCredits.slice(1);
      const activePkg =
        currentConsumingPkg ??
        sPkgs.find((p) => p.status === 'ACTIVE') ??
        sPkgs[0] ??
        null;

      const totalRemaining = activeWithCredits.reduce((acc, p) => acc + p.remaining_credits, 0);
      const hasEarlyRenewal = queuedPkgs.length > 0;
      const totalUnpaid =
        Math.round(sPkgs.reduce((acc, p) => acc + p.balance_due, 0) * 100) / 100;

      return {
        id,
        first_name: String(s.first_name),
        last_name: String(s.last_name),
        phone: String(s.phone),
        medical_notes: String(s.medical_notes || ''),
        created_at: String(s.created_at),
        active_package: activePkg,
        active_packages: activeWithCredits,
        current_consuming_package: currentConsumingPkg,
        queued_packages: queuedPkgs,
        total_remaining_credits: totalRemaining,
        has_early_renewal: hasEarlyRenewal,
        packages_count: sPkgs.length,
        total_unpaid_balance: totalUnpaid,
      };
    });

    res.json({ students });
  });

  router.post('/students', requireAuth, requireAdmin, (req, res) => {
    try {
      const firstName = String(req.body?.first_name || '').trim();
      const lastName = String(req.body?.last_name || '').trim();
      const phone = normalizeE164Phone(String(req.body?.phone || ''));
      const medicalNotes = String(req.body?.medical_notes || '').trim();

      if (!firstName || !lastName) {
        throw new AppError(400, 'INVALID_NAME', 'Nome e cognome dello studente sono obbligatori.');
      }
      if (!isValidE164Phone(phone)) {
        throw new AppError(
          400,
          'INVALID_PHONE',
          'Inserisci un numero di telefono in formato internazionale E.164 (es. +393401234567) per i promemoria WhatsApp.'
        );
      }

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const db = getDb();

      db.prepare(
        `INSERT INTO students (id, first_name, last_name, phone, medical_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, firstName, lastName, phone, medicalNotes, nowIso);

      recordAuditLog(db, req.user!.id, 'STUDENT_CREATED', id, {
        student_name: `${firstName} ${lastName}`,
      });
      broadcastSync('students', 'created');

      res.status(201).json({
        student: {
          id,
          first_name: firstName,
          last_name: lastName,
          phone,
          medical_notes: medicalNotes,
          created_at: nowIso,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.patch('/students/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(paramStr(req.params.id)) as
        | Record<string, unknown>
        | undefined;
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Studente non trovato.');

      const firstName =
        req.body?.first_name !== undefined
          ? String(req.body.first_name).trim()
          : String(existing.first_name);
      const lastName =
        req.body?.last_name !== undefined
          ? String(req.body.last_name).trim()
          : String(existing.last_name);
      const phone =
        req.body?.phone !== undefined
          ? normalizeE164Phone(String(req.body.phone))
          : String(existing.phone);
      const medicalNotes =
        req.body?.medical_notes !== undefined
          ? String(req.body.medical_notes).trim()
          : String(existing.medical_notes || '');

      if (!firstName || !lastName) {
        throw new AppError(400, 'INVALID_NAME', 'Nome e cognome sono obbligatori.');
      }
      if (!isValidE164Phone(phone)) {
        throw new AppError(
          400,
          'INVALID_PHONE',
          'Il telefono deve rispettare il formato internazionale E.164 (es. +393401234567).'
        );
      }

      db.prepare(
        `UPDATE students SET first_name = ?, last_name = ?, phone = ?, medical_notes = ? WHERE id = ?`
      ).run(firstName, lastName, phone, medicalNotes, paramStr(req.params.id));

      // Notifica anche gli appelli se le note posturali cambiano
      broadcastSync('bookings', 'student_updated', {
        staffSafeMessage: `Aggiornata scheda posturale di ${firstName} ${lastName}`,
      });
      broadcastSync('students', 'updated');

      res.json({
        student: {
          id: paramStr(req.params.id),
          first_name: firstName,
          last_name: lastName,
          phone,
          medical_notes: medicalNotes,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/students/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const info = db.prepare('DELETE FROM students WHERE id = ?').run(paramStr(req.params.id));
      if (info.changes === 0) throw new AppError(404, 'NOT_FOUND', 'Studente non trovato.');
      broadcastSync('all', 'student_deleted');
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // PACCHETTI LEZIONI (SRS 2.4 — RIGOROSAMENTE PROTETTO DA RLS, SOLO ADMIN)
  // ===========================================================================

  router.get('/packages', requireAuth, requireAdmin, (req, res) => {
    const packages = queryPackagesWithStats(getDb(), {
      studentId: req.query.studentId ? String(req.query.studentId) : undefined,
      paymentStatus: req.query.paymentStatus
        ? (String(req.query.paymentStatus) as PaymentStatus)
        : undefined,
      status: req.query.status ? (String(req.query.status) as PackageStatus) : undefined,
    });
    res.json({ packages });
  });

  router.post('/packages', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const settings = getStudioSettings(db);

      const studentId = String(req.body?.student_id || '').trim();
      const totalCredits =
        req.body?.total_credits !== undefined
          ? Number(req.body.total_credits)
          : settings.default_package_credits;
      const name =
        String(req.body?.name || '').trim() || `Pacchetto ${totalCredits} Lezioni Pilates`;
      const price = Number(req.body?.price);
      let paymentStatus = String(req.body?.payment_status || 'UNPAID') as PaymentStatus;
      let amountPaid =
        req.body?.amount_paid !== undefined
          ? Number(req.body.amount_paid)
          : paymentStatus === 'PAID'
            ? price
            : 0;
      const purchaseDate =
        String(req.body?.purchase_date || '').trim() || new Date().toISOString().slice(0, 10);
      const expirationDate = req.body?.expiration_date
        ? String(req.body.expiration_date).trim()
        : null;

      const student = db
        .prepare('SELECT id, first_name, last_name FROM students WHERE id = ?')
        .get(studentId) as { id: string; first_name: string; last_name: string } | undefined;
      if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Studente non trovato.');

      if (
        !Number.isInteger(totalCredits) ||
        totalCredits < settings.min_package_credits ||
        totalCredits > settings.max_package_credits
      ) {
        throw new AppError(
          400,
          'INVALID_CREDITS',
          `Il numero di lezioni deve essere compreso tra ${settings.min_package_credits} e ${settings.max_package_credits}.`
        );
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new AppError(400, 'INVALID_PRICE', 'Inserisci un prezzo valido.');
      }
      if (!['PAID', 'UNPAID', 'PARTIAL'].includes(paymentStatus)) {
        throw new AppError(400, 'INVALID_PAYMENT_STATUS', 'Stato pagamento non valido.');
      }

      if (paymentStatus === 'PAID') amountPaid = price;
      else if (paymentStatus === 'UNPAID') amountPaid = 0;
      else {
        if (!Number.isFinite(amountPaid) || amountPaid <= 0) paymentStatus = 'UNPAID';
        else if (amountPaid >= price) {
          amountPaid = price;
          paymentStatus = 'PAID';
        }
      }

      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO packages
          (id, student_id, name, total_credits, used_credits, frozen_credits, price, payment_status, amount_paid, purchase_date, expiration_date, status)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 'ACTIVE')`
      ).run(
        id,
        studentId,
        name,
        totalCredits,
        Math.round(price * 100) / 100,
        paymentStatus,
        Math.round(amountPaid * 100) / 100,
        purchaseDate,
        expirationDate
      );

      refreshPackageStatus(db, id);

      recordAuditLog(db, req.user!.id, 'PACKAGE_CREATED', id, {
        student_name: `${student.first_name} ${student.last_name}`,
        package_name: name,
        total_credits: totalCredits,
        price,
        payment_status: paymentStatus,
      });

      broadcastSync('packages', 'created');
      const created = queryPackagesWithStats(db, { studentId }).find((p) => p.id === id);
      res.status(201).json({ package: created });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.patch('/packages/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const existing = db
        .prepare(
          `SELECT p.*, s.first_name, s.last_name
           FROM packages p JOIN students s ON s.id = p.student_id
           WHERE p.id = ?`
        )
        .get(paramStr(req.params.id)) as Record<string, unknown> | undefined;
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Pacchetto non trovato.');

      const name =
        req.body?.name !== undefined ? String(req.body.name).trim() : String(existing.name);
      const totalCredits =
        req.body?.total_credits !== undefined
          ? Number(req.body.total_credits)
          : Number(existing.total_credits);
      const price =
        req.body?.price !== undefined ? Number(req.body.price) : Number(existing.price);
      let paymentStatus = (
        req.body?.payment_status !== undefined
          ? String(req.body.payment_status)
          : String(existing.payment_status)
      ) as PaymentStatus;
      let amountPaid =
        req.body?.amount_paid !== undefined
          ? Number(req.body.amount_paid)
          : Number(existing.amount_paid);
      const expirationDate =
        req.body?.expiration_date !== undefined
          ? req.body.expiration_date
            ? String(req.body.expiration_date).trim()
            : null
          : existing.expiration_date
            ? String(existing.expiration_date)
            : null;

      if (totalCredits < Number(existing.used_credits)) {
        throw new AppError(
          400,
          'CREDITS_BELOW_USED',
          `Impossibile impostare meno di ${existing.used_credits} lezioni (già usufruite).`
        );
      }

      if (req.body?.payment_status === 'PAID' && req.body?.amount_paid === undefined) {
        amountPaid = price;
      } else if (req.body?.payment_status === 'UNPAID' && req.body?.amount_paid === undefined) {
        amountPaid = 0;
      } else if (amountPaid >= price && price > 0) {
        amountPaid = price;
        paymentStatus = 'PAID';
      } else if (amountPaid > 0 && amountPaid < price) {
        paymentStatus = 'PARTIAL';
      } else if (amountPaid <= 0) {
        amountPaid = 0;
        paymentStatus = 'UNPAID';
      }

      db.prepare(
        `UPDATE packages
         SET name = ?, total_credits = ?, price = ?, payment_status = ?, amount_paid = ?, expiration_date = ?
         WHERE id = ?`
      ).run(
        name,
        totalCredits,
        Math.round(price * 100) / 100,
        paymentStatus,
        Math.round(amountPaid * 100) / 100,
        expirationDate,
        paramStr(req.params.id)
      );

      refreshPackageStatus(db, paramStr(req.params.id));

      if (
        paymentStatus !== existing.payment_status ||
        amountPaid !== Number(existing.amount_paid)
      ) {
        recordAuditLog(db, req.user!.id, 'PAYMENT_UPDATED', paramStr(req.params.id), {
          student_name: `${existing.first_name} ${existing.last_name}`,
          package_name: name,
          previous_payment_status: existing.payment_status,
          new_payment_status: paymentStatus,
          amount_paid: amountPaid,
          price,
        });
      }

      broadcastSync('packages', 'updated');
      const updated = queryPackagesWithStats(db).find((p) => p.id === paramStr(req.params.id));
      res.json({ package: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/packages/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const bCount = db
        .prepare('SELECT COUNT(*) AS cnt FROM bookings WHERE package_id = ?')
        .get(paramStr(req.params.id)) as { cnt: number };
      if (bCount.cnt > 0) {
        throw new AppError(
          409,
          'PACKAGE_IN_USE',
          `Impossibile eliminare: il pacchetto è associato a ${bCount.cnt} lezioni in archivio.`
        );
      }
      db.prepare('DELETE FROM packages WHERE id = ?').run(paramStr(req.params.id));
      broadcastSync('packages', 'deleted');
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // CALENDARIO, LEZIONI E ALGORITMO SLOT LIBERI (SRS 2.5, 3.1, 4.1)
  // ===========================================================================

  router.get('/lessons/free-slots', requireAuth, requireAdmin, (req, res) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const defaultEnd = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
      const startDate = String(req.query.startDate || today);
      const endDate = String(req.query.endDate || defaultEnd);

      const startParts = String(req.query.windowStart || '14:00').split(':');
      const endParts = String(req.query.windowEnd || '18:00').split(':');
      const weekdays = req.query.weekdays
        ? String(req.query.weekdays)
            .split(',')
            .map((n) => Number(n.trim()))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
        : [1, 2, 3, 4, 5];

      const slots = computeFreeSlots(getDb(), {
        startDate,
        endDate,
        windowStartHour: Number(startParts[0] ?? 14),
        windowStartMin: Number(startParts[1] ?? 0),
        windowEndHour: Number(endParts[0] ?? 18),
        windowEndMin: Number(endParts[1] ?? 0),
        weekdays,
        minDurationMinutes: req.query.minDuration ? Number(req.query.minDuration) : 60,
        roomId: req.query.roomId ? String(req.query.roomId) : undefined,
        teacherId: req.query.teacherId ? String(req.query.teacherId) : undefined,
      });

      res.json({ free_slots: slots });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/lessons', requireAuth, (req, res) => {
    try {
      const lessons = queryLessonSlots(getDb(), req.user!, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        teacherId: req.query.teacherId ? String(req.query.teacherId) : undefined,
        roomId: req.query.roomId ? String(req.query.roomId) : undefined,
        onlyTargeted: req.query.targeted === 'true',
        onlyUnvalidatedPast: req.query.unvalidatedPast === 'true',
      });
      res.json({ lessons });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Creazione lezione singola o ricorrente (istanzia singoli record lesson_slots — SRS 2.5)
  router.post('/lessons', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const title = String(req.body?.title || '').trim();
      const teacherId = String(req.body?.teacher_id || '').trim();
      const roomId = String(req.body?.room_id || '').trim();
      const startTime = new Date(String(req.body?.start_time || '')).toISOString();
      const endTime = new Date(String(req.body?.end_time || '')).toISOString();
      const isTargeted = req.body?.is_targeted ? 1 : 0;
      const notes = String(req.body?.notes || '').trim();
      const repeatWeeks = Math.min(12, Math.max(1, Number(req.body?.repeat_weeks || 1)));

      if (!title) throw new AppError(400, 'INVALID_TITLE', 'Inserisci il titolo del corso.');

      const room = db
        .prepare('SELECT id, name, default_capacity FROM rooms WHERE id = ? AND is_active = 1')
        .get(roomId) as { id: string; name: string; default_capacity: number } | undefined;
      if (!room) throw new AppError(404, 'ROOM_NOT_FOUND', 'Sala non trovata o non attiva.');

      const teacher = db
        .prepare(`SELECT id, full_name FROM users WHERE id = ? AND role = 'STAFF'`)
        .get(teacherId) as { id: string; full_name: string } | undefined;
      if (!teacher) throw new AppError(404, 'TEACHER_NOT_FOUND', 'Insegnante non trovata.');

      const maxCapacity =
        req.body?.max_capacity !== undefined
          ? Number(req.body.max_capacity)
          : room.default_capacity;
      if (!Number.isInteger(maxCapacity) || maxCapacity < 1 || maxCapacity > 100) {
        throw new AppError(400, 'INVALID_CAPACITY', 'Capienza massima non valida.');
      }

      const seriesId = repeatWeeks > 1 ? crypto.randomUUID() : null;
      const createdIds: string[] = [];

      runInTransaction(db, () => {
        const baseStartMs = new Date(startTime).getTime();
        const baseEndMs = new Date(endTime).getTime();
        const stmt = db.prepare(
          `INSERT INTO lesson_slots
            (id, title, teacher_id, room_id, start_time, end_time, max_capacity, is_targeted, notes, series_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        for (let w = 0; w < repeatWeeks; w++) {
          const sIso = new Date(baseStartMs + w * 7 * 86_400_000).toISOString();
          const eIso = new Date(baseEndMs + w * 7 * 86_400_000).toISOString();
          assertNoLessonConflicts(db, { roomId, teacherId, startTime: sIso, endTime: eIso });
          const id = crypto.randomUUID();
          stmt.run(id, title, teacherId, roomId, sIso, eIso, maxCapacity, isTargeted, notes, seriesId);
          createdIds.push(id);
        }

        recordAuditLog(db, req.user!.id, 'LESSON_CREATED', createdIds[0], {
          lesson_title: title,
          room_name: room.name,
          teacher_name: teacher.full_name,
          occurrences: repeatWeeks,
          is_targeted: Boolean(isTargeted),
        });
      });

      broadcastSync('lessons', 'created', {
        lessonSlotId: createdIds[0],
        staffSafeMessage: `Nuova lezione in calendario: ${title} (${room.name})`,
      });

      const created = queryLessonSlots(db, req.user!).filter((l) => createdIds.includes(l.id));
      res.status(201).json({ lessons: created, count: created.length });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.patch('/lessons/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT * FROM lesson_slots WHERE id = ?').get(paramStr(req.params.id)) as
        | Record<string, unknown>
        | undefined;
      if (!existing) throw new AppError(404, 'NOT_FOUND', 'Lezione non trovata.');

      const title =
        req.body?.title !== undefined ? String(req.body.title).trim() : String(existing.title);
      const teacherId =
        req.body?.teacher_id !== undefined
          ? String(req.body.teacher_id)
          : String(existing.teacher_id);
      const roomId =
        req.body?.room_id !== undefined ? String(req.body.room_id) : String(existing.room_id);
      const startTime =
        req.body?.start_time !== undefined
          ? new Date(String(req.body.start_time)).toISOString()
          : String(existing.start_time);
      const endTime =
        req.body?.end_time !== undefined
          ? new Date(String(req.body.end_time)).toISOString()
          : String(existing.end_time);
      const maxCapacity =
        req.body?.max_capacity !== undefined
          ? Number(req.body.max_capacity)
          : Number(existing.max_capacity);
      const isTargeted =
        req.body?.is_targeted !== undefined
          ? req.body.is_targeted
            ? 1
            : 0
          : Number(existing.is_targeted);
      const notes =
        req.body?.notes !== undefined ? String(req.body.notes).trim() : String(existing.notes || '');

      const activeBookings = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM bookings
           WHERE lesson_slot_id = ? AND attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')`
        )
        .get(paramStr(req.params.id)) as { cnt: number };

      if (maxCapacity < activeBookings.cnt) {
        throw new AppError(
          409,
          'CAPACITY_BELOW_BOOKINGS',
          `Ci sono già ${activeBookings.cnt} iscritti attivi: la capienza non può essere inferiore.`
        );
      }

      runInTransaction(db, () => {
        assertNoLessonConflicts(db, {
          roomId,
          teacherId,
          startTime,
          endTime,
          excludeSlotId: paramStr(req.params.id),
        });

        db.prepare(
          `UPDATE lesson_slots
           SET title = ?, teacher_id = ?, room_id = ?, start_time = ?, end_time = ?,
               max_capacity = ?, is_targeted = ?, notes = ?
           WHERE id = ?`
        ).run(
          title,
          teacherId,
          roomId,
          startTime,
          endTime,
          maxCapacity,
          isTargeted,
          notes,
          paramStr(req.params.id)
        );
      });

      broadcastSync('lessons', 'updated', {
        lessonSlotId: paramStr(req.params.id),
        staffSafeMessage: `Aggiornato corso: ${title}`,
      });

      const updated = queryLessonSlots(db, req.user!).find((l) => l.id === paramStr(req.params.id));
      res.json({ lesson: updated });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/lessons/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      runInTransaction(db, () => {
        const slot = db
          .prepare('SELECT id, title FROM lesson_slots WHERE id = ?')
          .get(paramStr(req.params.id)) as { id: string; title: string } | undefined;
        if (!slot) throw new AppError(404, 'NOT_FOUND', 'Lezione non trovata.');

        // Ripristina eventuali crediti scalati/congelati prima di rimuovere lo slot
        const bookings = db
          .prepare('SELECT package_id, attendance_status FROM bookings WHERE lesson_slot_id = ?')
          .all(paramStr(req.params.id)) as { package_id: string; attendance_status: AttendanceStatus }[];

        for (const b of bookings) {
          if (b.attendance_status === 'PRESENT' || b.attendance_status === 'ABSENT_DEDUCTED') {
            db.prepare(
              'UPDATE packages SET used_credits = MAX(0, used_credits - 1) WHERE id = ?'
            ).run(b.package_id);
            refreshPackageStatus(db, b.package_id);
          } else if (b.attendance_status === 'ABSENT_FROZEN') {
            db.prepare(
              'UPDATE packages SET frozen_credits = MAX(0, frozen_credits - 1) WHERE id = ?'
            ).run(b.package_id);
          }
        }

        db.prepare('DELETE FROM lesson_slots WHERE id = ?').run(paramStr(req.params.id));
        recordAuditLog(db, req.user!.id, 'LESSON_DELETED', paramStr(req.params.id), {
          lesson_title: slot.title,
        });
      });

      broadcastSync('all', 'lesson_deleted', { lessonSlotId: paramStr(req.params.id) });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // PRENOTAZIONI, APPELLO E GESTIONE CREDITI (SRS 2.6, 3.1.3, 3.2, 4.3)
  // ===========================================================================

  router.get('/lessons/:id/bookings', requireAuth, (req, res) => {
    try {
      const bookings = queryBookingsForLesson(getDb(), req.user!, paramStr(req.params.id));
      res.json({ bookings });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Assegnazione manuale studente a lezione da parte della Titolare (SRS 3.2.1: status=PENDING, 0 crediti scalati)
  router.post('/lessons/:id/bookings', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const lessonSlotId = paramStr(req.params.id);
      const studentId = String(req.body?.student_id || '').trim();
      let packageId = req.body?.package_id ? String(req.body.package_id).trim() : '';

      const bookingId = crypto.randomUUID();
      let studentFullName = '';
      let lessonTitle = '';

      runInTransaction(db, () => {
        const slot = db
          .prepare('SELECT id, title, max_capacity, is_validated FROM lesson_slots WHERE id = ?')
          .get(lessonSlotId) as
          | { id: string; title: string; max_capacity: number; is_validated: number }
          | undefined;
        if (!slot) throw new AppError(404, 'NOT_FOUND', 'Lezione non trovata.');
        if (slot.is_validated) {
          throw new AppError(
            409,
            'LESSON_LOCKED',
            "L'appello di questa lezione è già chiuso. Sblocca l'appello prima di aggiungere studenti."
          );
        }
        lessonTitle = slot.title;

        const student = db
          .prepare('SELECT id, first_name, last_name FROM students WHERE id = ?')
          .get(studentId) as { id: string; first_name: string; last_name: string } | undefined;
        if (!student) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Studente non trovato.');
        studentFullName = `${student.first_name} ${student.last_name}`;

        // Controllo capienza esplicito (oltre al trigger SQLite)
        const occ = db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM bookings
             WHERE lesson_slot_id = ? AND attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')`
          )
          .get(lessonSlotId) as { cnt: number };
        if (occ.cnt >= slot.max_capacity) {
          throw new AppError(
            409,
            'CAPACITY_EXCEEDED',
            `Capienza massima raggiunta (${occ.cnt}/${slot.max_capacity}): impossibile aggiungere altri iscritti.`
          );
        }

        // Selezione automatica pacchetto attivo se non specificato
        if (!packageId) {
          const activePkg = db
            .prepare(
              `SELECT id FROM packages
               WHERE student_id = ? AND used_credits < total_credits AND status = 'ACTIVE'
               ORDER BY purchase_date ASC LIMIT 1`
            )
            .get(studentId) as { id: string } | undefined;
          if (!activePkg) {
            throw new AppError(
              409,
              'NO_ACTIVE_PACKAGE',
              `${studentFullName} non ha un pacchetto attivo con lezioni disponibili. Crea o rinnova prima il suo pacchetto.`
            );
          }
          packageId = activePkg.id;
        } else {
          const pkg = db
            .prepare(
              'SELECT id, student_id, total_credits, used_credits, status FROM packages WHERE id = ?'
            )
            .get(packageId) as
            | {
                id: string;
                student_id: string;
                total_credits: number;
                used_credits: number;
                status: string;
              }
            | undefined;
          if (!pkg || pkg.student_id !== studentId) {
            throw new AppError(400, 'INVALID_PACKAGE', 'Pacchetto non valido per questo studente.');
          }
          if (pkg.used_credits >= pkg.total_credits || pkg.status === 'EXPIRED') {
            throw new AppError(
              409,
              'PACKAGE_EXHAUSTED',
              'Il pacchetto selezionato è esaurito o scaduto.'
            );
          }
        }

        db.prepare(
          `INSERT INTO bookings (id, lesson_slot_id, student_id, package_id, attendance_status, updated_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?)`
        ).run(bookingId, lessonSlotId, studentId, packageId, new Date().toISOString());
      });

      // Real-Time Sync istantaneo verso lo schermo dell'insegnante (SRS 5)
      broadcastSync('bookings', 'student_added', {
        lessonSlotId,
        staffSafeMessage: `${studentFullName} è stato aggiunto all'appello di "${lessonTitle}"`,
      });

      const bookings = queryBookingsForLesson(db, req.user!, lessonSlotId);
      res.status(201).json({ booking_id: bookingId, bookings });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Aggiornamento stato presenza / decisione assenza Titolare (SRS 3.2)
  router.patch('/bookings/:id/attendance', requireAuth, (req, res) => {
    try {
      const status = String(req.body?.attendance_status || '') as AttendanceStatus;
      const note = req.body?.reschedule_note !== undefined ? String(req.body.reschedule_note) : undefined;

      const result = updateBookingAttendance(getDb(), req.user!, paramStr(req.params.id), status, note);

      broadcastSync('bookings', 'attendance_updated', {
        lessonSlotId: result.lessonSlotId,
        adminOnlyMessage:
          status === 'RESCHEDULE_REQUESTED'
            ? `${req.user!.full_name} ha segnalato una richiesta di spostamento.`
            : status === 'ABSENT_PENDING_DECISION'
              ? `Nuova assenza in attesa di decisione (${req.user!.full_name}).`
              : undefined,
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Riprogrammazione prenotazione su nuova lezione (SRS 3.2.2 & 4.4.2)
  router.post('/bookings/:id/reschedule', requireAuth, requireAdmin, (req, res) => {
    try {
      const targetSlotId = String(req.body?.target_lesson_slot_id || '').trim();
      if (!targetSlotId) {
        throw new AppError(400, 'MISSING_TARGET', 'Seleziona la nuova lezione di destinazione.');
      }

      const result = rescheduleBookingToSlot(getDb(), req.user!, paramStr(req.params.id), targetSlotId);
      broadcastSync('bookings', 'rescheduled', {
        lessonSlotId: result.targetSlotId,
        staffSafeMessage: 'Nuovo recupero inserito in lista appello',
      });

      res.json({ ok: true, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Rimozione prenotazione da una lezione (Solo ADMIN, ripristina crediti se necessario)
  router.delete('/bookings/:id', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      let slotId = '';
      runInTransaction(db, () => {
        const b = db
          .prepare(
            `SELECT b.id, b.lesson_slot_id, b.package_id, b.attendance_status, ls.is_validated
             FROM bookings b JOIN lesson_slots ls ON ls.id = b.lesson_slot_id
             WHERE b.id = ?`
          )
          .get(paramStr(req.params.id)) as
          | {
              id: string;
              lesson_slot_id: string;
              package_id: string;
              attendance_status: AttendanceStatus;
              is_validated: number;
            }
          | undefined;
        if (!b) throw new AppError(404, 'NOT_FOUND', 'Prenotazione non trovata.');
        if (b.is_validated) {
          throw new AppError(
            409,
            'LESSON_LOCKED',
            "Sblocca l'appello prima di rimuovere un iscritto dalla lezione."
          );
        }
        slotId = b.lesson_slot_id;

        if (b.attendance_status === 'PRESENT' || b.attendance_status === 'ABSENT_DEDUCTED') {
          db.prepare('UPDATE packages SET used_credits = MAX(0, used_credits - 1) WHERE id = ?').run(
            b.package_id
          );
          refreshPackageStatus(db, b.package_id);
        } else if (b.attendance_status === 'ABSENT_FROZEN') {
          db.prepare(
            'UPDATE packages SET frozen_credits = MAX(0, frozen_credits - 1) WHERE id = ?'
          ).run(b.package_id);
        }

        db.prepare('DELETE FROM bookings WHERE id = ?').run(b.id);
      });

      broadcastSync('bookings', 'removed', {
        lessonSlotId: slotId,
        staffSafeMessage: 'Aggiornata lista iscritti della lezione',
      });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Conferma e Chiudi Appello (SRS 3.2.4 & 4.3)
  router.post('/lessons/:id/validate', requireAuth, (req, res) => {
    try {
      validateLessonRollCall(getDb(), req.user!, paramStr(req.params.id));
      broadcastSync('lessons', 'validated', {
        lessonSlotId: paramStr(req.params.id),
        adminOnlyMessage: `${req.user!.full_name} ha confermato e chiuso un appello.`,
      });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Sblocca Appello (SRS 3.2.4 — Solo Titolare)
  router.post('/lessons/:id/unlock', requireAuth, requireAdmin, (req, res) => {
    try {
      const reason = req.body?.reason ? String(req.body.reason) : undefined;
      unlockLessonRollCall(getDb(), req.user!, paramStr(req.params.id), reason);
      broadcastSync('lessons', 'unlocked', {
        lessonSlotId: paramStr(req.params.id),
        staffSafeMessage: 'La Titolare ha riaperto un appello per consentire modifiche.',
      });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // ===========================================================================
  // DASHBOARD TITOLARE, IMPOSTAZIONI, AUDIT LOG, EXPORT & DB LOCALE (SRS 4.4 & 5)
  // ===========================================================================

  router.get('/dashboard/admin', requireAuth, requireAdmin, (req, res) => {
    try {
      const period = req.query.period === 'month' ? 'month' : 'week';
      const data = buildAdminDashboard(getDb(), req.user!, period);
      res.json(data);
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/audit-logs', requireAuth, requireAdmin, (req, res) => {
    const logs = queryAuditLogs(getDb(), {
      actorId: req.query.actorId ? String(req.query.actorId) : undefined,
      actionType: req.query.actionType ? String(req.query.actionType) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 150,
    });
    res.json({ logs });
  });

  router.get('/settings', requireAuth, requireAdmin, (_req, res) => {
    res.json({ settings: getStudioSettings(getDb()) });
  });

  router.patch('/settings', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      const cur = getStudioSettings(db);
      const next = {
        studio_name:
          req.body?.studio_name !== undefined
            ? String(req.body.studio_name).trim() || cur.studio_name
            : cur.studio_name,
        studio_subtitle:
          req.body?.studio_subtitle !== undefined
            ? String(req.body.studio_subtitle).trim()
            : cur.studio_subtitle,
        studio_city:
          req.body?.studio_city !== undefined
            ? String(req.body.studio_city).trim()
            : cur.studio_city,
        owner_whatsapp:
          req.body?.owner_whatsapp !== undefined
            ? normalizeE164Phone(String(req.body.owner_whatsapp))
            : cur.owner_whatsapp,
        min_package_credits:
          req.body?.min_package_credits !== undefined
            ? Math.max(1, Number(req.body.min_package_credits))
            : cur.min_package_credits,
        max_package_credits:
          req.body?.max_package_credits !== undefined
            ? Math.max(1, Number(req.body.max_package_credits))
            : cur.max_package_credits,
        default_package_credits:
          req.body?.default_package_credits !== undefined
            ? Math.max(1, Number(req.body.default_package_credits))
            : cur.default_package_credits,
        renewal_alert_threshold:
          req.body?.renewal_alert_threshold !== undefined
            ? Math.max(0, Number(req.body.renewal_alert_threshold))
            : cur.renewal_alert_threshold,
      };

      if (!isValidE164Phone(next.owner_whatsapp)) {
        throw new AppError(400, 'INVALID_PHONE', 'Numero WhatsApp studio non valido (formato E.164).');
      }
      if (next.max_package_credits < next.min_package_credits) {
        throw new AppError(400, 'INVALID_RANGE', 'Il massimo lezioni deve essere >= al minimo.');
      }

      db.prepare(
        `INSERT INTO studio_settings
          (id, studio_name, studio_subtitle, studio_city, owner_whatsapp, min_package_credits, max_package_credits, default_package_credits, renewal_alert_threshold)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          studio_name = excluded.studio_name,
          studio_subtitle = excluded.studio_subtitle,
          studio_city = excluded.studio_city,
          owner_whatsapp = excluded.owner_whatsapp,
          min_package_credits = excluded.min_package_credits,
          max_package_credits = excluded.max_package_credits,
          default_package_credits = excluded.default_package_credits,
          renewal_alert_threshold = excluded.renewal_alert_threshold`
      ).run(
        next.studio_name,
        next.studio_subtitle,
        next.studio_city,
        next.owner_whatsapp,
        next.min_package_credits,
        next.max_package_credits,
        next.default_package_credits,
        next.renewal_alert_threshold
      );

      broadcastSync('settings', 'updated');
      res.json({ settings: next });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Esportazioni CSV / Excel / Backup JSON (SRS 5)
  router.get('/export/packages.csv', requireAuth, requireAdmin, (_req, res) => {
    const { packagesSheet } = getExportDatasets(getDb());
    const csv = buildCsvString(packagesSheet.headers, packagesSheet.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registro-pacchetti-pilates.csv"');
    res.send(csv);
  });

  router.get('/export/attendance.csv', requireAuth, requireAdmin, (_req, res) => {
    const { attendanceSheet } = getExportDatasets(getDb());
    const csv = buildCsvString(attendanceSheet.headers, attendanceSheet.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registro-presenze-pilates.csv"');
    res.send(csv);
  });

  router.get('/export/revenue.csv', requireAuth, requireAdmin, (_req, res) => {
    const { revenueSheet } = getExportDatasets(getDb());
    const csv = buildCsvString(revenueSheet.headers, revenueSheet.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registro-incassi-pilates.csv"');
    res.send(csv);
  });

  router.get('/export/contabilita.xls', requireAuth, requireAdmin, (_req, res) => {
    const { packagesSheet, revenueSheet, attendanceSheet } = getExportDatasets(getDb());
    const xml = buildExcelWorkbookXml([revenueSheet, packagesSheet, attendanceSheet]);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="contabilita-atelier-elan-${new Date().toISOString().slice(0, 10)}.xls"`
    );
    res.send(xml);
  });

  router.get('/export/backup.json', requireAuth, requireAdmin, (_req, res) => {
    const db = getDb();
    const snapshot = {
      exported_at: new Date().toISOString(),
      engine: 'sqlite-local-preproduction',
      studio_settings: getStudioSettings(db),
      rooms: db.prepare('SELECT * FROM rooms').all(),
      users: db
        .prepare(
          'SELECT id, role, full_name, email, phone, color, created_at FROM users'
        )
        .all(),
      students: db.prepare('SELECT * FROM students').all(),
      packages: db.prepare('SELECT * FROM packages').all(),
      lesson_slots: db.prepare('SELECT * FROM lesson_slots').all(),
      bookings: db.prepare('SELECT * FROM bookings').all(),
      audit_logs: db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC').all(),
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="backup-locale-pilates-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(snapshot, null, 2));
  });

  router.get('/export/supabase-schema.sql', requireAuth, requireAdmin, (_req, res) => {
    const sqlPath = path.resolve(process.cwd(), 'supabase/schema.sql');
    const content = fs.existsSync(sqlPath)
      ? fs.readFileSync(sqlPath, 'utf-8')
      : '-- Schema non trovato';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="supabase-production-schema.sql"');
    res.send(content);
  });

  // Ripristino dati dimostrativi database locale per test pre-produzione
  router.post('/admin/db/reset-demo', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      seedDatabase(db, { force: true });

      const newAdmin = db
        .prepare(
          `SELECT id, role, full_name, email, phone, color, push_subscription, google_calendar_token
           FROM users WHERE lower(email) = ?`
        )
        .get(DEMO_ACCOUNTS.admin.email) as {
        id: string;
        role: 'ADMIN' | 'STAFF';
        full_name: string;
        email: string;
        phone: string;
        color: string;
        push_subscription: string | null;
        google_calendar_token: string | null;
      };

      const token = signAuthToken(newAdmin);
      setAuthCookie(res, token, req);
      broadcastSync('all', 'db_reset', {
        staffSafeMessage: 'Il database locale di prova è stato ripristinato.',
      });

      res.json({
        ok: true,
        token,
        user: {
          id: newAdmin.id,
          role: newAdmin.role,
          full_name: newAdmin.full_name,
          email: newAdmin.email,
          phone: newAdmin.phone,
          color: newAdmin.color,
          has_push_subscription: false,
          google_calendar_token: newAdmin.google_calendar_token,
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
