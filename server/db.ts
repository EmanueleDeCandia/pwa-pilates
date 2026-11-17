import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const DEFAULT_DB_PATH = process.env.PILATES_DB_PATH
  ? path.resolve(process.env.PILATES_DB_PATH)
  : path.join(DATA_DIR, 'pilates.sqlite');

let dbInstance: DatabaseSync | null = null;

export function ensureDataDir(): string {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return DATA_DIR;
}

export function getSecrets(): { jwtSecret: string; calendarKey: string } {
  ensureDataDir();
  const secretsPath = path.join(DATA_DIR, 'secrets.json');
  if (fs.existsSync(secretsPath)) {
    try {
      return JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    } catch {
      // regenerate below
    }
  }
  const secrets = {
    jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex'),
    calendarKey: process.env.CALENDAR_KEY || crypto.randomBytes(32).toString('hex'),
  };
  fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

export function createDatabase(dbPath: string = DEFAULT_DB_PATH): DatabaseSync {
  const dir = path.dirname(dbPath);
  if (dbPath !== ':memory:' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  initializeSchema(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = createDatabase(DEFAULT_DB_PATH);
  }
  return dbInstance;
}

export function setDbForTesting(db: DatabaseSync): void {
  dbInstance = db;
}

/**
 * Esegue una funzione in transazione atomica SQLite (IMMEDIATE per prevenire race condition su capienza/conflitti).
 */
export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // already rolled back
    }
    throw err;
  }
}

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    -- Impostazioni Studio (configurazione pacchetti min/max, bacheca, soglia rinnovo)
    CREATE TABLE IF NOT EXISTS studio_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      studio_name TEXT NOT NULL DEFAULT 'Atelier Élan',
      studio_subtitle TEXT NOT NULL DEFAULT 'Studio Pilates & Danza Sportiva',
      studio_city TEXT NOT NULL DEFAULT 'Ancona',
      owner_whatsapp TEXT NOT NULL DEFAULT '+393471122334',
      min_package_credits INTEGER NOT NULL DEFAULT 1 CHECK (min_package_credits >= 1),
      max_package_credits INTEGER NOT NULL DEFAULT 30 CHECK (max_package_credits >= min_package_credits),
      default_package_credits INTEGER NOT NULL DEFAULT 10,
      renewal_alert_threshold INTEGER NOT NULL DEFAULT 2 CHECK (renewal_alert_threshold >= 0)
    );

    -- 2.1 users (Utenti di Sistema: ADMIN = Titolare, STAFF = Insegnante)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'STAFF')),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      phone TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#4A6759',
      push_subscription TEXT DEFAULT NULL,
      google_calendar_token TEXT DEFAULT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- 2.2 rooms (Sale)
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      default_capacity INTEGER NOT NULL CHECK (default_capacity >= 1),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    -- 2.3 students (Anagrafica Studenti — Zero-Login)
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      medical_notes TEXT NOT NULL DEFAULT '',
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
      archived_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- 2.4 packages (Pacchetti Lezioni — protetto da RLS, invisibile a STAFF)
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      total_credits INTEGER NOT NULL DEFAULT 10 CHECK (total_credits >= 1),
      used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0 AND used_credits <= total_credits),
      frozen_credits INTEGER NOT NULL DEFAULT 0 CHECK (frozen_credits >= 0),
      price REAL NOT NULL CHECK (price >= 0),
      payment_status TEXT NOT NULL CHECK (payment_status IN ('PAID', 'UNPAID', 'PARTIAL')),
      amount_paid REAL NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
      purchase_date TEXT NOT NULL,
      expiration_date TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED'))
    );

    -- 2.5 lesson_slots (Singole Occorrenze di Lezione)
    CREATE TABLE IF NOT EXISTS lesson_slots (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      max_capacity INTEGER NOT NULL CHECK (max_capacity >= 1),
      is_targeted INTEGER NOT NULL DEFAULT 0 CHECK (is_targeted IN (0, 1)),
      notes TEXT NOT NULL DEFAULT '',
      series_id TEXT DEFAULT NULL,
      is_validated INTEGER NOT NULL DEFAULT 0 CHECK (is_validated IN (0, 1)),
      validated_at TEXT DEFAULT NULL,
      validated_by TEXT DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
      CHECK (end_time > start_time)
    );

    -- 2.6 bookings (Iscrizioni / Presenze per Singola Lezione)
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      lesson_slot_id TEXT NOT NULL REFERENCES lesson_slots(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
      attendance_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        attendance_status IN (
          'PENDING',
          'PRESENT',
          'ABSENT_PENDING_DECISION',
          'ABSENT_DEDUCTED',
          'ABSENT_FROZEN',
          'RESCHEDULE_REQUESTED'
        )
      ),
      reschedule_note TEXT DEFAULT NULL,
      rescheduled_to_slot_id TEXT DEFAULT NULL REFERENCES lesson_slots(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (lesson_slot_id, student_id)
    );

    -- 2.7 audit_logs (Tracciamento Attività)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Magic Links per accesso rapido senza password insegnanti (SRS 1)
    CREATE TABLE IF NOT EXISTS magic_links (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Registro invii notifiche Web Push automatiche (-60m e +15m) per evitare duplicati (SRS 4.3)
    CREATE TABLE IF NOT EXISTS sent_notifications (
      lesson_slot_id TEXT NOT NULL REFERENCES lesson_slots(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('PRE_60M', 'POST_15M')),
      sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (lesson_slot_id, kind)
    );

    -- Indici per performance query calendario, appelli e KPI
    CREATE INDEX IF NOT EXISTS idx_lesson_slots_time ON lesson_slots(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_lesson_slots_room ON lesson_slots(room_id, start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_lesson_slots_teacher ON lesson_slots(teacher_id, start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(lesson_slot_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_package ON bookings(package_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(attendance_status);
    CREATE INDEX IF NOT EXISTS idx_packages_student ON packages(student_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

    -- =========================================================================
    -- 3.1 VINCOLI HARD A LIVELLO DATABASE (TRIGGER SQLITE)
    -- =========================================================================

    -- 1. Conflitto Sala (INSERT)
    CREATE TRIGGER IF NOT EXISTS trg_lesson_room_conflict_insert
    BEFORE INSERT ON lesson_slots
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM lesson_slots ls
      WHERE ls.room_id = NEW.room_id
        AND NEW.start_time < ls.end_time
        AND NEW.end_time > ls.start_time
    )
    BEGIN
      SELECT RAISE(ABORT, 'ROOM_CONFLICT: La sala selezionata è già occupata in questa fascia oraria.');
    END;

    -- 1b. Conflitto Sala (UPDATE)
    CREATE TRIGGER IF NOT EXISTS trg_lesson_room_conflict_update
    BEFORE UPDATE OF room_id, start_time, end_time ON lesson_slots
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM lesson_slots ls
      WHERE ls.room_id = NEW.room_id
        AND ls.id != NEW.id
        AND NEW.start_time < ls.end_time
        AND NEW.end_time > ls.start_time
    )
    BEGIN
      SELECT RAISE(ABORT, 'ROOM_CONFLICT: La sala selezionata è già occupata in questa fascia oraria.');
    END;

    -- 2. Conflitto Docente (INSERT)
    CREATE TRIGGER IF NOT EXISTS trg_lesson_teacher_conflict_insert
    BEFORE INSERT ON lesson_slots
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM lesson_slots ls
      WHERE ls.teacher_id = NEW.teacher_id
        AND NEW.start_time < ls.end_time
        AND NEW.end_time > ls.start_time
    )
    BEGIN
      SELECT RAISE(ABORT, 'TEACHER_CONFLICT: L''insegnante ha già una lezione assegnata in questa fascia oraria.');
    END;

    -- 2b. Conflitto Docente (UPDATE)
    CREATE TRIGGER IF NOT EXISTS trg_lesson_teacher_conflict_update
    BEFORE UPDATE OF teacher_id, start_time, end_time ON lesson_slots
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM lesson_slots ls
      WHERE ls.teacher_id = NEW.teacher_id
        AND ls.id != NEW.id
        AND NEW.start_time < ls.end_time
        AND NEW.end_time > ls.start_time
    )
    BEGIN
      SELECT RAISE(ABORT, 'TEACHER_CONFLICT: L''insegnante ha già una lezione assegnata in questa fascia oraria.');
    END;

    -- 3. Controllo Capienza (INSERT): prenotazioni attive = status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')
    CREATE TRIGGER IF NOT EXISTS trg_booking_capacity_insert
    BEFORE INSERT ON bookings
    FOR EACH ROW
    WHEN NEW.attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')
      AND (
        SELECT COUNT(*) FROM bookings b
        WHERE b.lesson_slot_id = NEW.lesson_slot_id
          AND b.attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')
      ) >= (SELECT max_capacity FROM lesson_slots WHERE id = NEW.lesson_slot_id)
    BEGIN
      SELECT RAISE(ABORT, 'CAPACITY_EXCEEDED: Capienza massima della lezione raggiunta.');
    END;

    -- 3b. Controllo Capienza (UPDATE da congelata/spostata a attiva)
    CREATE TRIGGER IF NOT EXISTS trg_booking_capacity_update
    BEFORE UPDATE OF attendance_status, lesson_slot_id ON bookings
    FOR EACH ROW
    WHEN NEW.attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')
      AND (
        SELECT COUNT(*) FROM bookings b
        WHERE b.lesson_slot_id = NEW.lesson_slot_id
          AND b.id != NEW.id
          AND b.attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED')
      ) >= (SELECT max_capacity FROM lesson_slots WHERE id = NEW.lesson_slot_id)
    BEGIN
      SELECT RAISE(ABORT, 'CAPACITY_EXCEEDED: Capienza massima della lezione raggiunta.');
    END;

    -- =========================================================================
    -- 4.1 Richieste Posto Zero-Login dalla Bacheca Pubblica (gestite dalla Titolare)
    -- =========================================================================
    CREATE TABLE IF NOT EXISTS public_inquiries (
      id TEXT PRIMARY KEY,
      lesson_slot_id TEXT REFERENCES lesson_slots(id) ON DELETE SET NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'HANDLED')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inquiries_status ON public_inquiries(status, created_at DESC);

    -- =========================================================================
    -- 5. SICUREZZA RLS LOCALE: VISTA ISOLATA PER RUOLO STAFF
    -- Esclude strutturalmente package_id, prezzi, crediti, stati pagamento e telefono
    -- =========================================================================
    CREATE VIEW IF NOT EXISTS staff_bookings_rls_view AS
    SELECT
      b.id,
      b.lesson_slot_id,
      ls.teacher_id AS assigned_teacher_id,
      b.student_id,
      s.first_name AS student_first_name,
      s.last_name AS student_last_name,
      s.medical_notes AS student_medical_notes,
      b.attendance_status,
      b.reschedule_note,
      b.updated_at
    FROM bookings b
    JOIN students s ON s.id = b.student_id
    JOIN lesson_slots ls ON ls.id = b.lesson_slot_id;
  `);

  // Migrazione retrocompatibile per DB esistenti: colonna is_archived e archived_at su students
  try {
    db.exec(`
      ALTER TABLE students ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));
    `);
  } catch {
    // colonna già presente
  }
  try {
    db.exec(`
      ALTER TABLE students ADD COLUMN archived_at TEXT DEFAULT NULL;
    `);
  } catch {
    // colonna già presente
  }
}

export function recordAuditLog(
  db: DatabaseSync,
  actorId: string,
  actionType: string,
  entityId: string,
  metadata: Record<string, unknown>,
  customTimestamp?: string
): void {
  const id = crypto.randomUUID();
  const createdAt = customTimestamp || new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, action_type, entity_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, actorId, actionType, entityId, JSON.stringify(metadata), createdAt);
}
