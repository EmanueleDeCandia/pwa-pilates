import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DEFAULT_DB_PATH, recordAuditLog, runInTransaction } from './db.js';
import type {
  ActionQueueItem,
  AdminBookingView,
  AdminDashboardData,
  AttendanceStatus,
  AuditLogEntry,
  AuthUser,
  FreeSlotSuggestion,
  LessonSlot,
  OccupancyMatrixCell,
  PackageStatus,
  PackageWithStats,
  PaymentStatus,
  PublicCourseSlot,
  Room,
  RoomOccupancyStat,
  StaffBookingView,
  StudioSettings,
  TrafficLightStatus,
} from '../shared/types.js';

export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function translateSqliteError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ROOM_CONFLICT')) {
    return new AppError(
      409,
      'ROOM_CONFLICT',
      'Conflitto Sala: la sala selezionata è già occupata in questa fascia oraria.'
    );
  }
  if (msg.includes('TEACHER_CONFLICT')) {
    return new AppError(
      409,
      'TEACHER_CONFLICT',
      "Conflitto Docente: l'insegnante selezionata ha già un corso sovrapposto in questa fascia oraria."
    );
  }
  if (msg.includes('CAPACITY_EXCEEDED')) {
    return new AppError(
      409,
      'CAPACITY_EXCEEDED',
      'Capienza massima raggiunta: nessun posto disponibile per questa lezione.'
    );
  }
  if (msg.includes('UNIQUE constraint failed: bookings.lesson_slot_id, bookings.student_id')) {
    return new AppError(
      409,
      'DUPLICATE_BOOKING',
      'Lo studente è già iscritto a questa lezione.'
    );
  }
  if (msg.includes('UNIQUE constraint failed: users.email')) {
    return new AppError(409, 'DUPLICATE_EMAIL', 'Esiste già un utente con questo indirizzo email.');
  }
  return new AppError(400, 'BAD_REQUEST', msg);
}

/**
 * Calcolo semaforo operativo lezione (SRS 4.4.1):
 * - GREEN: appello validato
 * - YELLOW: lezione in corso oppure terminata da <= 15 minuti
 * - RED: lezione terminata da > 15 minuti e non ancora validata
 * - UPCOMING: lezione futura non ancora iniziata
 */
export function computeTrafficLight(
  startTimeIso: string,
  endTimeIso: string,
  isValidated: boolean,
  nowMs: number = Date.now()
): TrafficLightStatus {
  if (isValidated) return 'GREEN';
  const startMs = new Date(startTimeIso).getTime();
  const endMs = new Date(endTimeIso).getTime();
  if (nowMs < startMs) return 'UPCOMING';
  if (nowMs <= endMs + 15 * 60_000) return 'YELLOW';
  return 'RED';
}

export function getStudioSettings(db: DatabaseSync): StudioSettings {
  const row = db.prepare('SELECT * FROM studio_settings WHERE id = 1').get() as
    | StudioSettings
    | undefined;
  if (!row) {
    return {
      studio_name: 'Atelier Élan',
      studio_subtitle: 'Studio Pilates & Danza Sportiva',
      studio_city: 'Ancona',
      owner_whatsapp: '+393471122334',
      min_package_credits: 1,
      max_package_credits: 30,
      default_package_credits: 10,
      renewal_alert_threshold: 2,
    };
  }
  return {
    studio_name: row.studio_name,
    studio_subtitle: row.studio_subtitle,
    studio_city: row.studio_city,
    owner_whatsapp: row.owner_whatsapp,
    min_package_credits: row.min_package_credits,
    max_package_credits: row.max_package_credits,
    default_package_credits: row.default_package_credits,
    renewal_alert_threshold: row.renewal_alert_threshold,
  };
}

export function refreshPackageStatus(db: DatabaseSync, packageId: string): PackageStatus {
  const pkg = db
    .prepare(
      `SELECT total_credits, used_credits, expiration_date FROM packages WHERE id = ?`
    )
    .get(packageId) as
    | { total_credits: number; used_credits: number; expiration_date: string | null }
    | undefined;
  if (!pkg) throw new AppError(404, 'NOT_FOUND', 'Pacchetto non trovato.');

  const todayIso = new Date().toISOString().slice(0, 10);
  let newStatus: PackageStatus = 'ACTIVE';
  if (pkg.used_credits >= pkg.total_credits) {
    newStatus = 'EXHAUSTED';
  } else if (pkg.expiration_date && pkg.expiration_date < todayIso) {
    newStatus = 'EXPIRED';
  }
  db.prepare('UPDATE packages SET status = ? WHERE id = ?').run(newStatus, packageId);
  return newStatus;
}

export function queryLessonSlots(
  db: DatabaseSync,
  actor: AuthUser,
  filters: {
    from?: string;
    to?: string;
    teacherId?: string;
    roomId?: string;
    onlyTargeted?: boolean;
    onlyUnvalidatedPast?: boolean;
  } = {}
): LessonSlot[] {
  const clauses: string[] = ['1=1'];
  const params: (string | number)[] = [];

  if (filters.from) {
    clauses.push('ls.end_time > ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('ls.start_time < ?');
    params.push(filters.to);
  }
  if (filters.teacherId) {
    clauses.push('ls.teacher_id = ?');
    params.push(filters.teacherId);
  }
  if (filters.roomId) {
    clauses.push('ls.room_id = ?');
    params.push(filters.roomId);
  }
  if (filters.onlyTargeted) {
    clauses.push('ls.is_targeted = 1');
  }
  if (filters.onlyUnvalidatedPast) {
    clauses.push('ls.end_time <= ?');
    params.push(new Date().toISOString());
    clauses.push(
      `(ls.is_validated = 0 OR EXISTS (
        SELECT 1 FROM bookings bx WHERE bx.lesson_slot_id = ls.id AND bx.attendance_status = 'PENDING'
      ))`
    );
  }

  const rows = db
    .prepare(
      `SELECT
        ls.id,
        ls.title,
        ls.teacher_id,
        u.full_name AS teacher_name,
        u.color AS teacher_color,
        u.phone AS teacher_phone,
        ls.room_id,
        r.name AS room_name,
        ls.start_time,
        ls.end_time,
        ls.max_capacity,
        ls.is_targeted,
        ls.notes,
        ls.series_id,
        ls.is_validated,
        ls.validated_at,
        ls.validated_by,
        uv.full_name AS validated_by_name,
        COALESCE(SUM(CASE WHEN b.id IS NOT NULL AND b.attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED') THEN 1 ELSE 0 END), 0) AS active_bookings_count,
        COALESCE(COUNT(b.id), 0) AS total_bookings_count,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_students_count,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'PRESENT' THEN 1 ELSE 0 END), 0) AS present_count,
        COALESCE(SUM(CASE WHEN b.attendance_status IN ('ABSENT_PENDING_DECISION', 'ABSENT_DEDUCTED', 'ABSENT_FROZEN', 'RESCHEDULE_REQUESTED') THEN 1 ELSE 0 END), 0) AS absent_count
       FROM lesson_slots ls
       JOIN users u ON u.id = ls.teacher_id
       JOIN rooms r ON r.id = ls.room_id
       LEFT JOIN users uv ON uv.id = ls.validated_by
       LEFT JOIN bookings b ON b.lesson_slot_id = ls.id
       WHERE ${clauses.join(' AND ')}
       GROUP BY ls.id
       ORDER BY ls.start_time ASC`
    )
    .all(...params) as Record<string, unknown>[];

  const nowMs = Date.now();
  const isAdmin = actor.role === 'ADMIN';

  return rows.map((row) => {
    const startTime = String(row.start_time);
    const endTime = String(row.end_time);
    const isValidated = Boolean(row.is_validated);
    return {
      id: String(row.id),
      title: String(row.title),
      teacher_id: String(row.teacher_id),
      teacher_name: String(row.teacher_name),
      teacher_color: String(row.teacher_color),
      ...(isAdmin ? { teacher_phone: String(row.teacher_phone) } : {}),
      room_id: String(row.room_id),
      room_name: String(row.room_name),
      start_time: startTime,
      end_time: endTime,
      max_capacity: Number(row.max_capacity),
      active_bookings_count: Number(row.active_bookings_count),
      total_bookings_count: Number(row.total_bookings_count),
      pending_students_count: Number(row.pending_students_count),
      present_count: Number(row.present_count),
      absent_count: Number(row.absent_count),
      is_targeted: Boolean(row.is_targeted),
      notes: String(row.notes || ''),
      series_id: row.series_id ? String(row.series_id) : null,
      is_validated: isValidated,
      validated_at: row.validated_at ? String(row.validated_at) : null,
      validated_by: row.validated_by ? String(row.validated_by) : null,
      validated_by_name: row.validated_by_name ? String(row.validated_by_name) : null,
      traffic_light: computeTrafficLight(startTime, endTime, isValidated, nowMs),
    };
  });
}

/**
 * Restituisce le prenotazioni di una lezione applicando RLS rigorosa:
 * - STAFF interroga esclusivamente la VIEW SQL `staff_bookings_rls_view` e SOLO per i propri corsi assegnati.
 * - ADMIN ottiene i dettagli completi (telefono WhatsApp, pacchetto e crediti).
 */
export function queryBookingsForLesson(
  db: DatabaseSync,
  actor: AuthUser,
  lessonSlotId: string
): StaffBookingView[] | AdminBookingView[] {
  const slot = db
    .prepare('SELECT id, teacher_id FROM lesson_slots WHERE id = ?')
    .get(lessonSlotId) as { id: string; teacher_id: string } | undefined;
  if (!slot) {
    throw new AppError(404, 'NOT_FOUND', 'Lezione non trovata.');
  }

  if (actor.role === 'STAFF') {
    if (slot.teacher_id !== actor.id) {
      throw new AppError(
        403,
        'RLS_FORBIDDEN',
        "Puoi visualizzare l'anagrafica iscritti e le note posturali solo dei tuoi corsi assegnati."
      );
    }

    const rows = db
      .prepare(
        `SELECT
          id,
          lesson_slot_id,
          student_id,
          student_first_name,
          student_last_name,
          student_medical_notes,
          attendance_status,
          reschedule_note,
          updated_at
         FROM staff_bookings_rls_view
         WHERE lesson_slot_id = ? AND assigned_teacher_id = ?
         ORDER BY student_last_name ASC, student_first_name ASC`
      )
      .all(lessonSlotId, actor.id) as unknown as StaffBookingView[];

    return rows.map((r) => ({
      id: r.id,
      lesson_slot_id: r.lesson_slot_id,
      student_id: r.student_id,
      student_first_name: r.student_first_name,
      student_last_name: r.student_last_name,
      student_medical_notes: r.student_medical_notes || '',
      attendance_status: r.attendance_status,
      reschedule_note: r.reschedule_note ?? null,
      updated_at: r.updated_at,
    }));
  }

  const rows = db
    .prepare(
      `SELECT
        b.id,
        b.lesson_slot_id,
        b.student_id,
        s.first_name AS student_first_name,
        s.last_name AS student_last_name,
        s.phone AS student_phone,
        s.medical_notes AS student_medical_notes,
        b.package_id,
        p.name AS package_name,
        p.total_credits AS package_total_credits,
        p.used_credits AS package_used_credits,
        (p.total_credits - p.used_credits) AS package_remaining_credits,
        p.payment_status AS package_payment_status,
        b.attendance_status,
        b.reschedule_note,
        b.rescheduled_to_slot_id,
        b.updated_at
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       JOIN packages p ON p.id = b.package_id
       WHERE b.lesson_slot_id = ?
       ORDER BY s.last_name ASC, s.first_name ASC`
    )
    .all(lessonSlotId) as unknown as AdminBookingView[];

  return rows.map((r) => ({
    ...r,
    student_medical_notes: r.student_medical_notes || '',
    reschedule_note: r.reschedule_note ?? null,
    rescheduled_to_slot_id: r.rescheduled_to_slot_id ?? null,
  }));
}

/**
 * Controllo conflitti dettagliato prima di insert/update di lesson_slots per messaggi user-friendly.
 */
export function assertNoLessonConflicts(
  db: DatabaseSync,
  params: {
    roomId: string;
    teacherId: string;
    startTime: string;
    endTime: string;
    excludeSlotId?: string;
  }
): void {
  if (new Date(params.endTime).getTime() <= new Date(params.startTime).getTime()) {
    throw new AppError(400, 'INVALID_TIME', "L'orario di fine deve essere successivo all'inizio.");
  }

  const excludeClause = params.excludeSlotId ? 'AND ls.id != ?' : '';
  const baseArgs = params.excludeSlotId
    ? [params.startTime, params.endTime, params.excludeSlotId]
    : [params.startTime, params.endTime];

  const roomConflict = db
    .prepare(
      `SELECT ls.title, ls.start_time, ls.end_time, r.name AS room_name
       FROM lesson_slots ls
       JOIN rooms r ON r.id = ls.room_id
       WHERE ls.room_id = ?
         AND ? < ls.end_time AND ? > ls.start_time
         ${excludeClause}
       LIMIT 1`
    )
    .get(params.roomId, ...baseArgs) as
    | { title: string; start_time: string; end_time: string; room_name: string }
    | undefined;

  if (roomConflict) {
    const hhmm1 = roomConflict.start_time.slice(11, 16);
    const hhmm2 = roomConflict.end_time.slice(11, 16);
    const day = roomConflict.start_time.slice(0, 10);
    throw new AppError(
      409,
      'ROOM_CONFLICT',
      `Conflitto Sala: "${roomConflict.room_name}" è già impegnata il ${day} (${hhmm1}–${hhmm2}) per "${roomConflict.title}".`
    );
  }

  const teacherConflict = db
    .prepare(
      `SELECT ls.title, ls.start_time, ls.end_time, u.full_name AS teacher_name
       FROM lesson_slots ls
       JOIN users u ON u.id = ls.teacher_id
       WHERE ls.teacher_id = ?
         AND ? < ls.end_time AND ? > ls.start_time
         ${excludeClause}
       LIMIT 1`
    )
    .get(params.teacherId, ...baseArgs) as
    | { title: string; start_time: string; end_time: string; teacher_name: string }
    | undefined;

  if (teacherConflict) {
    const hhmm1 = teacherConflict.start_time.slice(11, 16);
    const hhmm2 = teacherConflict.end_time.slice(11, 16);
    const day = teacherConflict.start_time.slice(0, 10);
    throw new AppError(
      409,
      'TEACHER_CONFLICT',
      `Conflitto Docente: ${teacherConflict.teacher_name} insegna già "${teacherConflict.title}" il ${day} (${hhmm1}–${hhmm2}).`
    );
  }
}

function usedCreditWeight(status: AttendanceStatus): number {
  return status === 'PRESENT' || status === 'ABSENT_DEDUCTED' ? 1 : 0;
}

function frozenCreditWeight(status: AttendanceStatus): number {
  return status === 'ABSENT_FROZEN' ? 1 : 0;
}

const STAFF_ALLOWED_STATUSES = new Set<AttendanceStatus>([
  'PENDING',
  'PRESENT',
  'ABSENT_PENDING_DECISION',
  'RESCHEDULE_REQUESTED',
]);

const ALL_STATUSES = new Set<AttendanceStatus>([
  'PENDING',
  'PRESENT',
  'ABSENT_PENDING_DECISION',
  'ABSENT_DEDUCTED',
  'ABSENT_FROZEN',
  'RESCHEDULE_REQUESTED',
]);

/**
 * Macchina a stati presenze e scalabilità crediti (SRS 3.2):
 * - Non scala mai alla prenotazione (PENDING -> 0 crediti scalati)
 * - PRESENT -> used_credits + 1 immediato
 * - ABSENT_PENDING_DECISION -> credito invariato, entra nella coda della Titolare
 * - RESCHEDULE_REQUESTED -> credito congelato/disponibile + nota, notifica la Titolare
 * - ABSENT_DEDUCTED (solo ADMIN) -> used_credits + 1
 * - ABSENT_FROZEN (solo ADMIN) -> frozen_credits + 1 (credito resta disponibile)
 * - Reversibile al 100% se l'insegnante cambia scelta prima della chiusura o dopo sblocco appello!
 */
export function updateBookingAttendance(
  db: DatabaseSync,
  actor: AuthUser,
  bookingId: string,
  newStatus: AttendanceStatus,
  rescheduleNote?: string | null
): { bookingId: string; lessonSlotId: string; newStatus: AttendanceStatus } {
  if (!ALL_STATUSES.has(newStatus)) {
    throw new AppError(400, 'INVALID_STATUS', 'Stato presenza non valido.');
  }

  return runInTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT
          b.id,
          b.lesson_slot_id,
          b.student_id,
          b.package_id,
          b.attendance_status AS old_status,
          b.reschedule_note AS old_note,
          ls.title AS lesson_title,
          ls.teacher_id,
          ls.is_validated,
          s.first_name,
          s.last_name,
          p.total_credits,
          p.used_credits,
          p.frozen_credits
         FROM bookings b
         JOIN lesson_slots ls ON ls.id = b.lesson_slot_id
         JOIN students s ON s.id = b.student_id
         JOIN packages p ON p.id = b.package_id
         WHERE b.id = ?`
      )
      .get(bookingId) as
      | {
          id: string;
          lesson_slot_id: string;
          student_id: string;
          package_id: string;
          old_status: AttendanceStatus;
          old_note: string | null;
          lesson_title: string;
          teacher_id: string;
          is_validated: number;
          first_name: string;
          last_name: string;
          total_credits: number;
          used_credits: number;
          frozen_credits: number;
        }
      | undefined;

    if (!row) {
      throw new AppError(404, 'NOT_FOUND', 'Prenotazione non trovata.');
    }

    if (actor.role === 'STAFF') {
      if (row.teacher_id !== actor.id) {
        throw new AppError(
          403,
          'RLS_FORBIDDEN',
          "Non puoi modificare le presenze di un corso assegnato a un'altra insegnante."
        );
      }
      if (row.is_validated) {
        throw new AppError(
          403,
          'LESSON_LOCKED',
          "L'appello è già stato chiuso e storicizzato. Contatta la Titolare per richiedere lo sblocco."
        );
      }
      if (!STAFF_ALLOWED_STATUSES.has(newStatus)) {
        throw new AppError(
          403,
          'RLS_FORBIDDEN',
          'Solo la Titolare può decidere se scalare o congelare un’assenza.'
        );
      }
      if (row.old_status === 'ABSENT_DEDUCTED' || row.old_status === 'ABSENT_FROZEN') {
        throw new AppError(
          403,
          'ADMIN_DECIDED',
          "Questa assenza è già stata gestita dalla Titolare e può essere modificata solo dall'amministrazione."
        );
      }
    }

    const deltaUsed = usedCreditWeight(newStatus) - usedCreditWeight(row.old_status);
    const deltaFrozen = frozenCreditWeight(newStatus) - frozenCreditWeight(row.old_status);

    const nextUsed = row.used_credits + deltaUsed;
    const nextFrozen = Math.max(0, row.frozen_credits + deltaFrozen);

    if (nextUsed > row.total_credits) {
      throw new AppError(
        409,
        'NO_CREDITS_LEFT',
        `Crediti esauriti nel pacchetto di ${row.first_name} ${row.last_name}: rinnova il pacchetto prima di scalare la lezione.`
      );
    }
    if (nextUsed < 0) {
      throw new AppError(400, 'INVALID_CREDITS', 'Conteggio crediti non valido.');
    }

    const cleanNote =
      newStatus === 'RESCHEDULE_REQUESTED'
        ? rescheduleNote !== undefined
          ? rescheduleNote?.trim() || null
          : row.old_note
        : rescheduleNote !== undefined
          ? rescheduleNote?.trim() || null
          : null;

    const nowIso = new Date().toISOString();

    try {
      db.prepare(
        `UPDATE bookings
         SET attendance_status = ?, reschedule_note = ?, updated_at = ?
         WHERE id = ?`
      ).run(newStatus, cleanNote, nowIso, row.id);
    } catch (err) {
      throw translateSqliteError(err);
    }

    if (deltaUsed !== 0 || deltaFrozen !== 0) {
      db.prepare(
        `UPDATE packages SET used_credits = ?, frozen_credits = ? WHERE id = ?`
      ).run(nextUsed, nextFrozen, row.package_id);
      refreshPackageStatus(db, row.package_id);
    }

    let actionType = 'ATTENDANCE_UPDATED';
    if (newStatus === 'ABSENT_DEDUCTED') actionType = 'CREDIT_DEDUCTED';
    else if (newStatus === 'PRESENT' && deltaUsed > 0) actionType = 'CREDIT_DEDUCTED';
    else if (newStatus === 'ABSENT_FROZEN') actionType = 'CREDIT_FROZEN';
    else if (newStatus === 'RESCHEDULE_REQUESTED') actionType = 'RESCHEDULE_REQUESTED';

    if (row.old_status !== newStatus || row.old_note !== cleanNote) {
      recordAuditLog(db, actor.id, actionType, row.id, {
        lesson_slot_id: row.lesson_slot_id,
        lesson_title: row.lesson_title,
        student_name: `${row.first_name} ${row.last_name}`,
        previous_status: row.old_status,
        new_status: newStatus,
        ...(cleanNote ? { note: cleanNote } : {}),
      });
    }

    return { bookingId: row.id, lessonSlotId: row.lesson_slot_id, newStatus };
  });
}

/**
 * Chiusura e validazione appello lezione (SRS 3.2.4 e 4.3).
 */
export function validateLessonRollCall(
  db: DatabaseSync,
  actor: AuthUser,
  lessonSlotId: string
): void {
  runInTransaction(db, () => {
    const slot = db
      .prepare(
        `SELECT ls.id, ls.title, ls.teacher_id, ls.start_time, ls.is_validated, r.name AS room_name
         FROM lesson_slots ls
         JOIN rooms r ON r.id = ls.room_id
         WHERE ls.id = ?`
      )
      .get(lessonSlotId) as
      | {
          id: string;
          title: string;
          teacher_id: string;
          start_time: string;
          is_validated: number;
          room_name: string;
        }
      | undefined;

    if (!slot) throw new AppError(404, 'NOT_FOUND', 'Lezione non trovata.');
    if (actor.role === 'STAFF' && slot.teacher_id !== actor.id) {
      throw new AppError(403, 'RLS_FORBIDDEN', 'Puoi validare solo i tuoi corsi assegnati.');
    }
    if (slot.is_validated) {
      return; // già validato
    }

    const counts = db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN attendance_status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_cnt,
          COALESCE(SUM(CASE WHEN attendance_status = 'PRESENT' THEN 1 ELSE 0 END), 0) AS present_cnt,
          COALESCE(SUM(CASE WHEN attendance_status != 'PRESENT' AND attendance_status != 'PENDING' THEN 1 ELSE 0 END), 0) AS absent_cnt
         FROM bookings WHERE lesson_slot_id = ?`
      )
      .get(lessonSlotId) as { pending_cnt: number; present_cnt: number; absent_cnt: number };

    if (counts.pending_cnt > 0) {
      throw new AppError(
        400,
        'PENDING_STUDENTS',
        `Segna prima l'esito per tutti gli iscritti (${counts.pending_cnt} ancora in attesa).`
      );
    }

    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE lesson_slots
       SET is_validated = 1, validated_at = ?, validated_by = ?
       WHERE id = ?`
    ).run(nowIso, actor.id, lessonSlotId);

    recordAuditLog(db, actor.id, 'ATTENDANCE_VALIDATED', lessonSlotId, {
      lesson_title: slot.title,
      room_name: slot.room_name,
      lesson_start: slot.start_time,
      present_count: counts.present_cnt,
      absent_count: counts.absent_cnt,
    });
  });
}

/**
 * Sblocco appello riservato esclusivamente alla Titolare (SRS 3.2.4).
 */
export function unlockLessonRollCall(
  db: DatabaseSync,
  actor: AuthUser,
  lessonSlotId: string,
  reason?: string
): void {
  if (actor.role !== 'ADMIN') {
    throw new AppError(403, 'RLS_FORBIDDEN', 'Solo la Titolare può sbloccare un appello chiuso.');
  }

  runInTransaction(db, () => {
    const slot = db
      .prepare(
        `SELECT ls.id, ls.title, ls.is_validated, ls.validated_at, r.name AS room_name
         FROM lesson_slots ls
         JOIN rooms r ON r.id = ls.room_id
         WHERE ls.id = ?`
      )
      .get(lessonSlotId) as
      | {
          id: string;
          title: string;
          is_validated: number;
          validated_at: string | null;
          room_name: string;
        }
      | undefined;

    if (!slot) throw new AppError(404, 'NOT_FOUND', 'Lezione non trovata.');

    db.prepare(
      `UPDATE lesson_slots
       SET is_validated = 0, validated_at = NULL, validated_by = NULL
       WHERE id = ?`
    ).run(lessonSlotId);

    recordAuditLog(db, actor.id, 'LESSON_UNLOCKED', lessonSlotId, {
      lesson_title: slot.title,
      room_name: slot.room_name,
      previous_validated_at: slot.validated_at,
      reason: reason?.trim() || 'Sblocco manuale Titolare per rettifica presenze',
    });
  });
}

/**
 * Riprogrammazione manuale da parte della Titolare di una lezione con RESCHEDULE_REQUESTED o ABSENT_FROZEN.
 */
export function rescheduleBookingToSlot(
  db: DatabaseSync,
  actor: AuthUser,
  bookingId: string,
  targetSlotId: string
): { newBookingId: string; sourceSlotId: string; targetSlotId: string } {
  if (actor.role !== 'ADMIN') {
    throw new AppError(403, 'RLS_FORBIDDEN', 'Solo la Titolare può riprogrammare le lezioni.');
  }

  return runInTransaction(db, () => {
    const src = db
      .prepare(
        `SELECT b.id, b.lesson_slot_id, b.student_id, b.package_id, b.attendance_status,
                s.first_name, s.last_name,
                ls.title AS source_title,
                p.total_credits, p.used_credits
         FROM bookings b
         JOIN students s ON s.id = b.student_id
         JOIN lesson_slots ls ON ls.id = b.lesson_slot_id
         JOIN packages p ON p.id = b.package_id
         WHERE b.id = ?`
      )
      .get(bookingId) as
      | {
          id: string;
          lesson_slot_id: string;
          student_id: string;
          package_id: string;
          attendance_status: AttendanceStatus;
          first_name: string;
          last_name: string;
          source_title: string;
          total_credits: number;
          used_credits: number;
        }
      | undefined;

    if (!src) throw new AppError(404, 'NOT_FOUND', 'Prenotazione di origine non trovata.');
    if (
      src.attendance_status !== 'RESCHEDULE_REQUESTED' &&
      src.attendance_status !== 'ABSENT_FROZEN'
    ) {
      throw new AppError(
        400,
        'INVALID_RESCHEDULE',
        'Solo le prenotazioni con richiesta di spostamento o assenza congelata possono essere riprogrammate.'
      );
    }
    if (src.used_credits >= src.total_credits) {
      throw new AppError(
        409,
        'NO_CREDITS_LEFT',
        'Il pacchetto dello studente non ha più crediti disponibili.'
      );
    }

    const target = db
      .prepare('SELECT id, title, start_time FROM lesson_slots WHERE id = ?')
      .get(targetSlotId) as { id: string; title: string; start_time: string } | undefined;
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Lezione di destinazione non trovata.');

    const newBookingId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    try {
      db.prepare(
        `INSERT INTO bookings (id, lesson_slot_id, student_id, package_id, attendance_status, updated_at)
         VALUES (?, ?, ?, ?, 'PENDING', ?)`
      ).run(newBookingId, targetSlotId, src.student_id, src.package_id, nowIso);
    } catch (err) {
      throw translateSqliteError(err);
    }

    db.prepare(
      `UPDATE bookings SET rescheduled_to_slot_id = ?, updated_at = ? WHERE id = ?`
    ).run(targetSlotId, nowIso, src.id);

    recordAuditLog(db, actor.id, 'BOOKING_RESCHEDULED', newBookingId, {
      student_name: `${src.first_name} ${src.last_name}`,
      from_lesson: src.source_title,
      to_lesson: target.title,
      to_start_time: target.start_time,
    });

    return { newBookingId, sourceSlotId: src.lesson_slot_id, targetSlotId };
  });
}

/**
 * Algoritmo Rilevamento Slot Liberi (SRS 4.1):
 * Dato un intervallo date, giorni della settimana (es. 1..5 = Lun-Ven),
 * fascia oraria (es. 14:00 - 18:00) e durata minima (es. 60 min),
 * sottrae gli slot occupati con risoluzione a 15 minuti ed evidenzia i blocchi
 * contigui in cui almeno una sala attiva E almeno un'insegnante sono libere.
 */
export function computeFreeSlots(
  db: DatabaseSync,
  options: {
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    windowStartHour?: number;
    windowStartMin?: number;
    windowEndHour?: number;
    windowEndMin?: number;
    weekdays?: number[]; // 1=Lun .. 6=Sab, 0=Dom
    minDurationMinutes?: number;
    roomId?: string;
    teacherId?: string;
  }
): FreeSlotSuggestion[] {
  const winStartMin = (options.windowStartHour ?? 14) * 60 + (options.windowStartMin ?? 0);
  const winEndMin = (options.windowEndHour ?? 18) * 60 + (options.windowEndMin ?? 0);
  const minDur = Math.max(30, options.minDurationMinutes ?? 60);
  const allowedDays = new Set(options.weekdays ?? [1, 2, 3, 4, 5]);

  if (winEndMin - winStartMin < minDur) return [];

  let rooms = db
    .prepare(
      `SELECT id, name, default_capacity FROM rooms WHERE is_active = 1 ORDER BY name ASC`
    )
    .all() as Pick<Room, 'id' | 'name' | 'default_capacity'>[];
  if (options.roomId) {
    rooms = rooms.filter((r) => r.id === options.roomId);
  }

  let teachers = db
    .prepare(
      `SELECT id, full_name, color FROM users WHERE role = 'STAFF' ORDER BY full_name ASC`
    )
    .all() as { id: string; full_name: string; color: string }[];
  if (options.teacherId) {
    teachers = teachers.filter((t) => t.id === options.teacherId);
  }

  if (rooms.length === 0 || teachers.length === 0) return [];

  const rangeStartIso = `${options.startDate}T00:00:00.000Z`;
  const rangeEndIso = `${options.endDate}T23:59:59.999Z`;

  const existingSlots = db
    .prepare(
      `SELECT room_id, teacher_id, start_time, end_time
       FROM lesson_slots
       WHERE end_time > ? AND start_time < ?`
    )
    .all(rangeStartIso, rangeEndIso) as {
    room_id: string;
    teacher_id: string;
    start_time: string;
    end_time: string;
  }[];

  const parsedSlots = existingSlots.map((s) => ({
    roomId: s.room_id,
    teacherId: s.teacher_id,
    startMs: new Date(s.start_time).getTime(),
    endMs: new Date(s.end_time).getTime(),
  }));

  const results: FreeSlotSuggestion[] = [];
  const stepMin = 15;

  const startDay = new Date(`${options.startDate}T00:00:00.000Z`);
  const endDay = new Date(`${options.endDate}T00:00:00.000Z`);

  // Limite sicurezza massimo 31 giorni
  for (
    let cursor = new Date(startDay), guard = 0;
    cursor <= endDay && guard < 31;
    cursor.setUTCDate(cursor.getUTCDate() + 1), guard++
  ) {
    const dow = cursor.getUTCDay();
    if (!allowedDays.has(dow)) continue;

    const dateStr = cursor.toISOString().slice(0, 10);
    const dayBaseMs = cursor.getTime();

    type StepState = {
      startMs: number;
      endMs: number;
      freeRoomIds: string[];
      freeTeacherIds: string[];
      sig: string;
    };

    const steps: StepState[] = [];
    for (let m = winStartMin; m + stepMin <= winEndMin; m += stepMin) {
      const sMs = dayBaseMs + m * 60_000;
      const eMs = dayBaseMs + (m + stepMin) * 60_000;

      const freeRoomIds = rooms
        .filter(
          (r) => !parsedSlots.some((ps) => ps.roomId === r.id && sMs < ps.endMs && eMs > ps.startMs)
        )
        .map((r) => r.id);

      const freeTeacherIds = teachers
        .filter(
          (t) =>
            !parsedSlots.some((ps) => ps.teacherId === t.id && sMs < ps.endMs && eMs > ps.startMs)
        )
        .map((t) => t.id);

      const sig =
        freeRoomIds.length > 0 && freeTeacherIds.length > 0
          ? `${freeRoomIds.join(',')}|${freeTeacherIds.join(',')}`
          : '';

      steps.push({ startMs: sMs, endMs: eMs, freeRoomIds, freeTeacherIds, sig });
    }

    // Unisci step contigui con la stessa combinazione di sale e docenti liberi
    let i = 0;
    while (i < steps.length) {
      if (!steps[i].sig) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < steps.length && steps[j + 1].sig === steps[i].sig) {
        j++;
      }
      const blockStartMs = steps[i].startMs;
      const blockEndMs = steps[j].endMs;
      const durationMinutes = Math.round((blockEndMs - blockStartMs) / 60_000);

      if (durationMinutes >= minDur) {
        const roomSet = new Set(steps[i].freeRoomIds);
        const teacherSet = new Set(steps[i].freeTeacherIds);
        results.push({
          date: dateStr,
          start_time: new Date(blockStartMs).toISOString(),
          end_time: new Date(blockEndMs).toISOString(),
          duration_minutes: durationMinutes,
          available_rooms: rooms.filter((r) => roomSet.has(r.id)),
          available_teachers: teachers.filter((t) => teacherSet.has(t.id)),
        });
      }
      i = j + 1;
    }
  }

  return results;
}

/**
 * Query pacchetti completa con analitica frequenza presenze/assenze (SRS 4.4.4 — SOLO ADMIN).
 */
export function queryPackagesWithStats(
  db: DatabaseSync,
  filters: { studentId?: string; paymentStatus?: PaymentStatus; status?: PackageStatus } = {}
): PackageWithStats[] {
  const clauses = ['1=1'];
  const params: string[] = [];

  if (filters.studentId) {
    clauses.push('p.student_id = ?');
    params.push(filters.studentId);
  }
  if (filters.paymentStatus) {
    clauses.push('p.payment_status = ?');
    params.push(filters.paymentStatus);
  }
  if (filters.status) {
    clauses.push('p.status = ?');
    params.push(filters.status);
  }

  const rows = db
    .prepare(
      `SELECT
        p.id,
        p.student_id,
        s.first_name AS student_first_name,
        s.last_name AS student_last_name,
        s.phone AS student_phone,
        p.name,
        p.total_credits,
        p.used_credits,
        p.frozen_credits,
        p.price,
        p.payment_status,
        p.amount_paid,
        p.purchase_date,
        p.expiration_date,
        p.status,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'PRESENT' THEN 1 ELSE 0 END), 0) AS present_count,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'ABSENT_DEDUCTED' THEN 1 ELSE 0 END), 0) AS absent_deducted_count,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'ABSENT_FROZEN' THEN 1 ELSE 0 END), 0) AS absent_frozen_count,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'ABSENT_PENDING_DECISION' THEN 1 ELSE 0 END), 0) AS absent_pending_count,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'RESCHEDULE_REQUESTED' THEN 1 ELSE 0 END), 0) AS reschedule_requested_count,
        COALESCE(SUM(CASE WHEN b.attendance_status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_bookings_count
       FROM packages p
       JOIN students s ON s.id = p.student_id
       LEFT JOIN bookings b ON b.package_id = p.id
       WHERE ${clauses.join(' AND ')}
       GROUP BY p.id
       ORDER BY p.purchase_date DESC, s.last_name ASC`
    )
    .all(...params) as Record<string, unknown>[];

  const todayIso = new Date().toISOString().slice(0, 10);

  const mapped: PackageWithStats[] = rows.map((r) => {
    const totalCredits = Number(r.total_credits);
    const usedCredits = Number(r.used_credits);
    const remaining = Math.max(0, totalCredits - usedCredits);
    const price = Number(r.price);
    const amountPaid = Number(r.amount_paid);
    const balanceDue = Math.max(0, Math.round((price - amountPaid) * 100) / 100);
    const expDate = r.expiration_date ? String(r.expiration_date) : null;

    let status = String(r.status) as PackageStatus;
    if (usedCredits >= totalCredits) status = 'EXHAUSTED';
    else if (expDate && expDate < todayIso) status = 'EXPIRED';
    else status = 'ACTIVE';

    const absentDeducted = Number(r.absent_deducted_count);
    const absentFrozen = Number(r.absent_frozen_count);
    const absentPending = Number(r.absent_pending_count);

    return {
      id: String(r.id),
      student_id: String(r.student_id),
      student_first_name: String(r.student_first_name),
      student_last_name: String(r.student_last_name),
      student_phone: String(r.student_phone),
      name: String(r.name),
      total_credits: totalCredits,
      used_credits: usedCredits,
      frozen_credits: Number(r.frozen_credits),
      remaining_credits: remaining,
      price,
      payment_status: String(r.payment_status) as PaymentStatus,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      purchase_date: String(r.purchase_date),
      expiration_date: expDate,
      status,
      present_count: Number(r.present_count),
      absent_deducted_count: absentDeducted,
      absent_frozen_count: absentFrozen,
      absent_pending_count: absentPending,
      reschedule_requested_count: Number(r.reschedule_requested_count),
      pending_bookings_count: Number(r.pending_bookings_count),
      total_absences: absentDeducted + absentFrozen + absentPending,
      is_consuming: false,
      is_queued_renewal: false,
    };
  });

  // Calcolo stato di consumo FIFO e rinnovi in coda per ciascun allievo
  const byStudent = new Map<string, PackageWithStats[]>();
  for (const p of mapped) {
    if (!byStudent.has(p.student_id)) byStudent.set(p.student_id, []);
    byStudent.get(p.student_id)!.push(p);
  }

  for (const [, pList] of byStudent) {
    const activeWithCredits = pList
      .filter((p) => p.status === 'ACTIVE' && p.remaining_credits > 0)
      .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));

    if (activeWithCredits.length > 0) {
      activeWithCredits[0].is_consuming = true;
      for (let i = 1; i < activeWithCredits.length; i++) {
        activeWithCredits[i].is_queued_renewal = true;
      }
    }
  }

  return mapped;
}

/**
 * Bacheca pubblica senza login (SRS 4.1): espone SOLO i corsi mirati futuri e i posti residui.
 */
export function queryPublicTargetedCourses(db: DatabaseSync): {
  studio: Pick<StudioSettings, 'studio_name' | 'studio_subtitle' | 'studio_city' | 'owner_whatsapp'>;
  courses: PublicCourseSlot[];
} {
  const settings = getStudioSettings(db);
  const nowIso = new Date().toISOString();

  const rows = db
    .prepare(
      `SELECT
        ls.id,
        ls.title,
        ls.notes,
        r.name AS room_name,
        u.full_name AS teacher_name,
        u.color AS teacher_color,
        ls.start_time,
        ls.end_time,
        ls.max_capacity,
        COALESCE(SUM(CASE WHEN b.id IS NOT NULL AND b.attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED') THEN 1 ELSE 0 END), 0) AS active_cnt
       FROM lesson_slots ls
       JOIN rooms r ON r.id = ls.room_id
       JOIN users u ON u.id = ls.teacher_id
       LEFT JOIN bookings b ON b.lesson_slot_id = ls.id
       WHERE ls.is_targeted = 1
         AND r.is_active = 1
         AND ls.start_time >= ?
       GROUP BY ls.id
       ORDER BY ls.start_time ASC
       LIMIT 30`
    )
    .all(nowIso) as Record<string, unknown>[];

  return {
    studio: {
      studio_name: settings.studio_name,
      studio_subtitle: settings.studio_subtitle,
      studio_city: settings.studio_city,
      owner_whatsapp: settings.owner_whatsapp,
    },
    courses: rows.map((r) => {
      const cap = Number(r.max_capacity);
      const used = Number(r.active_cnt);
      const firstName = String(r.teacher_name).split(' ')[0];
      return {
        id: String(r.id),
        title: String(r.title),
        notes: String(r.notes || ''),
        room_name: String(r.room_name),
        teacher_first_name: firstName,
        teacher_color: String(r.teacher_color),
        start_time: String(r.start_time),
        end_time: String(r.end_time),
        max_capacity: cap,
        remaining_spots: Math.max(0, cap - used),
      };
    }),
  };
}

/**
 * Dashboard di Monitoraggio e KPI della Titolare (SRS 4.4 — tutti e 6 i quadranti).
 */
export function buildAdminDashboard(
  db: DatabaseSync,
  adminActor: AuthUser,
  occupancyPeriod: 'week' | 'month' = 'week'
): AdminDashboardData {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayStart = `${todayStr}T00:00:00.000Z`;
  const todayEnd = `${todayStr}T23:59:59.999Z`;

  // 1. Stato Operativo Giornaliero
  const todayLessons = queryLessonSlots(db, adminActor, {
    from: todayStart,
    to: todayEnd,
  });

  // 2. Coda Azioni Richieste (Assenze da decidere + Spostamenti non ancora riprogrammati)
  const queueRows = db
    .prepare(
      `SELECT
        b.id AS booking_id,
        b.lesson_slot_id,
        ls.title AS lesson_title,
        ls.start_time AS lesson_start_time,
        r.name AS room_name,
        u.full_name AS teacher_name,
        s.id AS student_id,
        s.first_name AS student_first_name,
        s.last_name AS student_last_name,
        s.phone AS student_phone,
        p.id AS package_id,
        p.name AS package_name,
        (p.total_credits - p.used_credits) AS package_remaining_credits,
        b.attendance_status,
        b.reschedule_note,
        b.updated_at
       FROM bookings b
       JOIN lesson_slots ls ON ls.id = b.lesson_slot_id
       JOIN rooms r ON r.id = ls.room_id
       JOIN users u ON u.id = ls.teacher_id
       JOIN students s ON s.id = b.student_id
       JOIN packages p ON p.id = b.package_id
       WHERE b.attendance_status = 'ABSENT_PENDING_DECISION'
          OR (b.attendance_status = 'RESCHEDULE_REQUESTED' AND b.rescheduled_to_slot_id IS NULL)
       ORDER BY ls.start_time DESC`
    )
    .all() as unknown as ActionQueueItem[];

  const absentPendingQueue = queueRows.filter(
    (q) => q.attendance_status === 'ABSENT_PENDING_DECISION'
  );
  const rescheduleQueue = queueRows.filter(
    (q) => q.attendance_status === 'RESCHEDULE_REQUESTED'
  );

  // 3 & 4. KPI Finanziari, Alert Rinnovo e Analitica Frequenza Pacchetti
  const settings = getStudioSettings(db);
  const allPackages = queryPackagesWithStats(db);

  const unpaidPackages = allPackages.filter(
    (p) => p.payment_status === 'UNPAID' || p.payment_status === 'PARTIAL'
  );
  const lowCreditPackages = allPackages
    .filter((p) => p.remaining_credits <= settings.renewal_alert_threshold || p.status === 'EXPIRED')
    .sort((a, b) => a.remaining_credits - b.remaining_credits);

  const totalSalesAmount = Math.round(allPackages.reduce((acc, p) => acc + p.price, 0) * 100) / 100;
  const totalCollectedAmount =
    Math.round(allPackages.reduce((acc, p) => acc + p.amount_paid, 0) * 100) / 100;
  const totalOutstandingAmount =
    Math.round(unpaidPackages.reduce((acc, p) => acc + p.balance_due, 0) * 100) / 100;

  const totalCreditsSold = allPackages.reduce((acc, p) => acc + p.total_credits, 0);
  const totalPresent = allPackages.reduce((acc, p) => acc + p.present_count, 0);
  const totalAbsentDeducted = allPackages.reduce((acc, p) => acc + p.absent_deducted_count, 0);
  const totalAbsentFrozen = allPackages.reduce((acc, p) => acc + p.absent_frozen_count, 0);
  const totalAbsentPending = allPackages.reduce((acc, p) => acc + p.absent_pending_count, 0);
  const totalAbsences = totalAbsentDeducted + totalAbsentFrozen + totalAbsentPending;
  const totalRemainingCredits = allPackages.reduce((acc, p) => acc + p.remaining_credits, 0);
  const recordedSessions = totalPresent + totalAbsences;
  const attendanceRatePct =
    recordedSessions > 0 ? Math.round((totalPresent / recordedSessions) * 100) : 100;

  // 5. KPI Utilizzo Risorse (Settimanale / Mensile) e Matrice Giorni × Ore
  let periodStart: Date;
  let periodEnd: Date;
  let workingDaysInPeriod: number;

  if (occupancyPeriod === 'week') {
    const dow = now.getUTCDay(); // 0=Dom, 1=Lun
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMon, 0, 0, 0)
    );
    periodEnd = new Date(periodStart.getTime() + 7 * 86_400_000);
    workingDaysInPeriod = 6; // Lun-Sab
  } else {
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
    workingDaysInPeriod = 25;
  }

  const activeRooms = db
    .prepare('SELECT id, name, default_capacity FROM rooms WHERE is_active = 1 ORDER BY name ASC')
    .all() as { id: string; name: string; default_capacity: number }[];

  const periodSlots = db
    .prepare(
      `SELECT
        ls.id,
        ls.room_id,
        ls.start_time,
        ls.end_time,
        ls.max_capacity,
        COALESCE(SUM(CASE WHEN b.id IS NOT NULL AND b.attendance_status NOT IN ('ABSENT_FROZEN', 'RESCHEDULE_REQUESTED') THEN 1 ELSE 0 END), 0) AS booked
       FROM lesson_slots ls
       LEFT JOIN bookings b ON b.lesson_slot_id = ls.id
       WHERE ls.start_time >= ? AND ls.start_time < ?
       GROUP BY ls.id`
    )
    .all(periodStart.toISOString(), periodEnd.toISOString()) as {
    id: string;
    room_id: string;
    start_time: string;
    end_time: string;
    max_capacity: number;
    booked: number;
  }[];

  const studioDailyHours = 12; // 08:00 - 20:00
  const availableHoursPerRoom = workingDaysInPeriod * studioDailyHours;

  const roomOccupancy: RoomOccupancyStat[] = activeRooms.map((room) => {
    const rSlots = periodSlots.filter((s) => s.room_id === room.id);
    const hoursUsed =
      Math.round(
        rSlots.reduce((acc, s) => {
          const durH =
            (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3_600_000;
          return acc + durH;
        }, 0) * 10
      ) / 10;
    const totalSeatsOffered = rSlots.reduce((acc, s) => acc + Number(s.max_capacity), 0);
    const totalSeatsBooked = rSlots.reduce((acc, s) => acc + Number(s.booked), 0);
    return {
      room_id: room.id,
      room_name: room.name,
      default_capacity: room.default_capacity,
      lessons_count: rSlots.length,
      hours_used: hoursUsed,
      available_hours: availableHoursPerRoom,
      time_utilization_pct: Math.min(100, Math.round((hoursUsed / availableHoursPerRoom) * 100)),
      total_seats_offered: totalSeatsOffered,
      total_seats_booked: totalSeatsBooked,
      seat_occupancy_pct:
        totalSeatsOffered > 0 ? Math.round((totalSeatsBooked / totalSeatsOffered) * 100) : 0,
    };
  });

  // Matrice Giorni (1=Lun..6=Sab) × Fasce Orarie (08..20)
  const occupancyMatrix: OccupancyMatrixCell[] = [];
  const weeksMultiplier = occupancyPeriod === 'month' ? 4 : 1;
  const totalRoomSlotsPerCell = Math.max(1, activeRooms.length * weeksMultiplier);

  for (let dow = 1; dow <= 6; dow++) {
    for (let hour = 8; hour <= 20; hour++) {
      const matching = periodSlots.filter((s) => {
        const st = new Date(s.start_time);
        const en = new Date(s.end_time);
        if (st.getUTCDay() !== dow) return false;
        const cellStart = new Date(
          Date.UTC(st.getUTCFullYear(), st.getUTCMonth(), st.getUTCDate(), hour, 0, 0)
        );
        const cellEnd = new Date(cellStart.getTime() + 3_600_000);
        return st < cellEnd && en > cellStart;
      });

      const bookedSeats = matching.reduce((a, s) => a + Number(s.booked), 0);
      const totalCapacity = matching.reduce((a, s) => a + Number(s.max_capacity), 0);
      const roomsBusy = new Set(matching.map((m) => m.room_id)).size;

      occupancyMatrix.push({
        day_of_week: dow,
        hour,
        booked_seats: bookedSeats,
        total_capacity: totalCapacity,
        slots_count: matching.length,
        rooms_busy: roomsBusy,
        total_rooms: activeRooms.length,
        room_utilization_pct: Math.min(
          100,
          Math.round((matching.length / totalRoomSlotsPerCell) * 100)
        ),
        seat_occupancy_pct:
          totalCapacity > 0 ? Math.round((bookedSeats / totalCapacity) * 100) : 0,
      });
    }
  }

  // 5b. Monte ore lezioni svolte (validate) per insegnante nel mese corrente (SRS 3.3 e 4.4.5)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const nowIso = now.toISOString();

  const teachers = db
    .prepare(
      `SELECT id, full_name, color, phone FROM users WHERE role = 'STAFF' ORDER BY full_name ASC`
    )
    .all() as { id: string; full_name: string; color: string; phone: string }[];

  const teacherHours = teachers.map((t) => {
    const monthSlots = db
      .prepare(
        `SELECT start_time, end_time, is_validated
         FROM lesson_slots
         WHERE teacher_id = ? AND start_time >= ? AND start_time < ?`
      )
      .all(t.id, monthStart, monthEnd) as {
      start_time: string;
      end_time: string;
      is_validated: number;
    }[];

    let validatedHours = 0;
    let validatedLessons = 0;
    let scheduledHours = 0;
    for (const s of monthSlots) {
      const h = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3_600_000;
      scheduledHours += h;
      if (s.is_validated) {
        validatedHours += h;
        validatedLessons += 1;
      }
    }

    const unval = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM lesson_slots
         WHERE teacher_id = ? AND end_time <= ? AND is_validated = 0`
      )
      .get(t.id, nowIso) as { cnt: number };

    return {
      teacher_id: t.id,
      full_name: t.full_name,
      color: t.color,
      phone: t.phone,
      validated_hours_month: Math.round(validatedHours * 100) / 100,
      validated_lessons_month: validatedLessons,
      scheduled_hours_month: Math.round(scheduledHours * 100) / 100,
      unvalidated_past_lessons: Number(unval.cnt),
    };
  });

  // 6. Audit Log recente
  const recentAuditLogs = queryAuditLogs(db, { limit: 15 });

  const unvalTotalRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM lesson_slots WHERE end_time <= ? AND is_validated = 0`)
    .get(nowIso) as { cnt: number };

  // Info database locale di pre-produzione (include file principale + registro WAL)
  let fileSizeBytes = 0;
  for (const candidate of [DEFAULT_DB_PATH, `${DEFAULT_DB_PATH}-wal`]) {
    try {
      if (fs.existsSync(candidate)) {
        fileSizeBytes += fs.statSync(candidate).size;
      }
    } catch {
      // ignore
    }
  }

  const countTable = (tbl: string) =>
    Number((db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get() as { c: number }).c);

  return {
    today_lessons: todayLessons,
    absent_pending_queue: absentPendingQueue,
    reschedule_queue: rescheduleQueue,
    unpaid_packages: unpaidPackages,
    low_credit_packages: lowCreditPackages,
    total_outstanding_amount: totalOutstandingAmount,
    total_collected_amount: totalCollectedAmount,
    total_sales_amount: totalSalesAmount,
    frequency_aggregate: {
      total_credits_sold: totalCreditsSold,
      total_present: totalPresent,
      total_absences: totalAbsences,
      total_absent_deducted: totalAbsentDeducted,
      total_absent_frozen: totalAbsentFrozen,
      total_absent_pending: totalAbsentPending,
      total_remaining_credits: totalRemainingCredits,
      attendance_rate_pct: attendanceRatePct,
    },
    package_analytics: allPackages,
    room_occupancy: roomOccupancy,
    occupancy_matrix: occupancyMatrix,
    occupancy_period: occupancyPeriod,
    teacher_hours: teacherHours,
    recent_audit_logs: recentAuditLogs,
    unvalidated_past_total: Number(unvalTotalRow.cnt),
    db_info: {
      engine: 'SQLite 3 (WAL + Trigger + RLS View)',
      file_path: 'data/pilates.sqlite',
      file_size_bytes: fileSizeBytes,
      counts: {
        users: countTable('users'),
        rooms: countTable('rooms'),
        students: countTable('students'),
        packages: countTable('packages'),
        lesson_slots: countTable('lesson_slots'),
        bookings: countTable('bookings'),
        audit_logs: countTable('audit_logs'),
      },
    },
  };
}

export function queryAuditLogs(
  db: DatabaseSync,
  filters: { actorId?: string; actionType?: string; from?: string; limit?: number } = {}
): AuditLogEntry[] {
  const clauses = ['1=1'];
  const params: (string | number)[] = [];

  if (filters.actorId) {
    clauses.push('al.actor_id = ?');
    params.push(filters.actorId);
  }
  if (filters.actionType) {
    clauses.push('al.action_type = ?');
    params.push(filters.actionType);
  }
  if (filters.from) {
    clauses.push('al.created_at >= ?');
    params.push(filters.from);
  }

  const limit = Math.min(500, filters.limit ?? 100);
  params.push(limit);

  const rows = db
    .prepare(
      `SELECT
        al.id,
        al.actor_id,
        u.full_name AS actor_name,
        u.role AS actor_role,
        al.action_type,
        al.entity_id,
        al.metadata,
        al.created_at
       FROM audit_logs al
       JOIN users u ON u.id = al.actor_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY al.created_at DESC
       LIMIT ?`
    )
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(String(r.metadata || '{}'));
    } catch {
      meta = {};
    }
    return {
      id: String(r.id),
      actor_id: String(r.actor_id),
      actor_name: String(r.actor_name),
      actor_role: r.actor_role as 'ADMIN' | 'STAFF',
      action_type: String(r.action_type),
      entity_id: String(r.entity_id),
      metadata: meta,
      created_at: String(r.created_at),
    };
  });
}

/**
 * Generatore feed dinamico iCalendar (.ics) per sincronizzazione Google Calendar docente (SRS 4.3):
 * Include due VALARM nativi: -60 minuti prima dell'inizio e +15 minuti dopo la fine!
 */
function toIcsUtc(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function generateTeacherIcsFeed(db: DatabaseSync, calendarToken: string): string | null {
  const user = db
    .prepare(`SELECT id, full_name, role FROM users WHERE google_calendar_token = ?`)
    .get(calendarToken) as { id: string; full_name: string; role: string } | undefined;

  if (!user) return null;

  const settings = getStudioSettings(db);
  const fromIso = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const slots =
    user.role === 'ADMIN'
      ? (db
          .prepare(
            `SELECT ls.id, ls.title, ls.start_time, ls.end_time, ls.notes, ls.is_validated,
                    r.name AS room_name, u.full_name AS teacher_name
             FROM lesson_slots ls
             JOIN rooms r ON r.id = ls.room_id
             JOIN users u ON u.id = ls.teacher_id
             WHERE ls.start_time >= ?
             ORDER BY ls.start_time ASC`
          )
          .all(fromIso) as Record<string, unknown>[])
      : (db
          .prepare(
            `SELECT ls.id, ls.title, ls.start_time, ls.end_time, ls.notes, ls.is_validated,
                    r.name AS room_name, u.full_name AS teacher_name
             FROM lesson_slots ls
             JOIN rooms r ON r.id = ls.room_id
             JOIN users u ON u.id = ls.teacher_id
             WHERE ls.teacher_id = ? AND ls.start_time >= ?
             ORDER BY ls.start_time ASC`
          )
          .all(user.id, fromIso) as Record<string, unknown>[]);

  const dtstamp = toIcsUtc(new Date().toISOString());
  const calName = `${settings.studio_name} — Turni ${user.full_name}`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Atelier Elan//PWA Gestionale Pilates//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(calName)}`,
    'X-WR-TIMEZONE:UTC',
  ];

  for (const s of slots) {
    const statusText = s.is_validated ? 'Appello validato' : 'Appello da confermare a fine lezione';
    const desc = [
      `Sala: ${s.room_name}`,
      `Insegnante: ${s.teacher_name}`,
      `Stato: ${statusText}`,
      s.notes ? `Note: ${s.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:slot-${s.id}@atelierpilates.local`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toIcsUtc(String(s.start_time))}`,
      `DTEND:${toIcsUtc(String(s.end_time))}`,
      `SUMMARY:${escapeIcs(`${s.title} (${s.room_name})`)}`,
      `LOCATION:${escapeIcs(`${s.room_name} — ${settings.studio_name}`)}`,
      `DESCRIPTION:${escapeIcs(desc)}`,
      // Alert 1: 60 minuti prima dell'inizio (SRS 4.3)
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(`Promemoria turno tra 60 min: ${s.title} in ${s.room_name}`)}`,
      'END:VALARM',
      // Alert 2: 15 minuti dopo la fine per ricordare la validazione appello (SRS 4.3)
      'BEGIN:VALARM',
      'TRIGGER;RELATED=END:PT15M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(`Conferma e chiudi l'appello di ${s.title} sull'app PWA`)}`,
      'END:VALARM',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ============================================================================
// 5. ESPORTAZIONE CSV / EXCEL PER CONTABILITÀ FISCALE (SRS 5)
// ============================================================================

function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",;\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsvString(headers: string[], rows: unknown[][]): string {
  const BOM = '\uFEFF'; // UTF-8 BOM per apertura perfetta in Microsoft Excel
  const lines = [
    headers.map(escapeCsvCell).join(';'),
    ...rows.map((r) => r.map(escapeCsvCell).join(';')),
  ];
  return BOM + lines.join('\r\n') + '\r\n';
}

function escapeXml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildExcelWorkbookXml(
  sheets: { name: string; headers: string[]; rows: (string | number | null)[][] }[]
): string {
  const worksheets = sheets
    .map((sheet) => {
      const headerRow = `<Row ss:StyleID="Header">${sheet.headers
        .map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
        .join('')}</Row>`;
      const dataRows = sheet.rows
        .map((row) => {
          const cells = row
            .map((cell) => {
              if (typeof cell === 'number' && Number.isFinite(cell)) {
                return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
              }
              return `<Cell><Data ss:Type="String">${escapeXml(cell ?? '')}</Data></Cell>`;
            })
            .join('');
          return `<Row>${cells}</Row>`;
        })
        .join('\n');
      return `<Worksheet ss:Name="${escapeXml(sheet.name.slice(0, 31))}"><Table>${headerRow}\n${dataRows}</Table></Worksheet>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#4A6759" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 ${worksheets}
</Workbook>`;
}

const PAYMENT_LABELS_IT: Record<string, string> = {
  PAID: 'Saldato',
  PARTIAL: 'Acconto',
  UNPAID: 'Da saldare',
};

const ATTENDANCE_LABELS_IT: Record<string, string> = {
  PENDING: 'In attesa',
  PRESENT: 'Presente',
  ABSENT_PENDING_DECISION: 'Assente (da decidere)',
  ABSENT_DEDUCTED: 'Assente (scalata)',
  ABSENT_FROZEN: 'Assente (congelata)',
  RESCHEDULE_REQUESTED: 'Richiesta spostamento',
};

export function getExportDatasets(db: DatabaseSync) {
  const pkgs = queryPackagesWithStats(db);

  const packagesSheet = {
    name: 'Registro Pacchetti',
    headers: [
      'Studente',
      'Telefono',
      'Pacchetto',
      'Data Acquisto',
      'Scadenza',
      'Lezioni Totali',
      'Lezioni Usate',
      'Lezioni Congelate',
      'Lezioni Residue',
      'Presenze',
      'Assenze Scalate',
      'Assenze Congelate',
      'Stato Pacchetto',
      'Prezzo (EUR)',
      'Versato (EUR)',
      'Saldo Dovuto (EUR)',
      'Stato Pagamento',
    ],
    rows: pkgs.map((p) => [
      `${p.student_last_name} ${p.student_first_name}`,
      p.student_phone ?? '',
      p.name,
      p.purchase_date,
      p.expiration_date ?? '',
      p.total_credits,
      p.used_credits,
      p.frozen_credits,
      p.remaining_credits,
      p.present_count,
      p.absent_deducted_count,
      p.absent_frozen_count,
      p.status,
      p.price,
      p.amount_paid,
      p.balance_due,
      PAYMENT_LABELS_IT[p.payment_status] ?? p.payment_status,
    ]),
  };

  const revenueSheet = {
    name: 'Registro Incassi',
    headers: [
      'Data Acquisto',
      'Cognome',
      'Nome',
      'Telefono',
      'Pacchetto',
      'Importo Totale (EUR)',
      'Importo Incassato (EUR)',
      'Residuo da Incassare (EUR)',
      'Stato Pagamento',
    ],
    rows: pkgs.map((p) => [
      p.purchase_date,
      p.student_last_name ?? '',
      p.student_first_name ?? '',
      p.student_phone ?? '',
      p.name,
      p.price,
      p.amount_paid,
      p.balance_due,
      PAYMENT_LABELS_IT[p.payment_status] ?? p.payment_status,
    ]),
  };

  const attRows = db
    .prepare(
      `SELECT
        ls.start_time,
        ls.end_time,
        ls.title AS lesson_title,
        r.name AS room_name,
        u.full_name AS teacher_name,
        s.last_name,
        s.first_name,
        p.name AS package_name,
        b.attendance_status,
        b.reschedule_note,
        ls.is_validated,
        ls.validated_at
       FROM bookings b
       JOIN lesson_slots ls ON ls.id = b.lesson_slot_id
       JOIN rooms r ON r.id = ls.room_id
       JOIN users u ON u.id = ls.teacher_id
       JOIN students s ON s.id = b.student_id
       JOIN packages p ON p.id = b.package_id
       ORDER BY ls.start_time DESC, s.last_name ASC`
    )
    .all() as Record<string, unknown>[];

  const attendanceSheet = {
    name: 'Registro Presenze',
    headers: [
      'Data',
      'Orario',
      'Corso',
      'Sala',
      'Insegnante',
      'Studente',
      'Pacchetto',
      'Esito Presenza',
      'Note Spostamento',
      'Appello Validato',
      'Timestamp Validazione',
    ],
    rows: attRows.map((r) => {
      const st = String(r.start_time);
      const en = String(r.end_time);
      const status = String(r.attendance_status);
      return [
        st.slice(0, 10),
        `${st.slice(11, 16)}-${en.slice(11, 16)}`,
        String(r.lesson_title),
        String(r.room_name),
        String(r.teacher_name),
        `${r.last_name} ${r.first_name}`,
        String(r.package_name),
        ATTENDANCE_LABELS_IT[status] ?? status,
        r.reschedule_note ? String(r.reschedule_note) : '',
        r.is_validated ? 'Sì' : 'No',
        r.validated_at ? String(r.validated_at) : '',
      ];
    }),
  };

  return { packagesSheet, revenueSheet, attendanceSheet };
}
