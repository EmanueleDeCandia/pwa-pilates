import type { AttendanceStatus, FreeSlotSuggestion, LessonSlot, PaymentStatus, PublicCourseSlot } from '../../shared/types';

const MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

const MONTHS_SHORT_IT = [
  'gen', 'feb', 'mar', 'apr', 'mag', 'giu',
  'lug', 'ago', 'set', 'ott', 'nov', 'dic',
];

const WEEKDAYS_IT = [
  'Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato',
];

const WEEKDAYS_SHORT_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

export function formatDateLong(isoOrDate: string): string {
  const d = new Date(isoOrDate.length === 10 ? `${isoOrDate}T00:00:00.000Z` : isoOrDate);
  return `${WEEKDAYS_IT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_IT[d.getUTCMonth()]}`;
}

export function formatDateShort(isoOrDate: string): string {
  const d = new Date(isoOrDate.length === 10 ? `${isoOrDate}T00:00:00.000Z` : isoOrDate);
  return `${WEEKDAYS_SHORT_IT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT_IT[d.getUTCMonth()]}`;
}

export function formatDateNumeric(isoOrDate: string): string {
  const d = new Date(isoOrDate.length === 10 ? `${isoOrDate}T00:00:00.000Z` : isoOrDate);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function formatDateTimeCompact(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_SHORT_IT[d.getUTCMonth()]} · ${formatTime(iso)}`;
}

export function formatMonthYear(date: Date = new Date()): string {
  const m = MONTHS_IT[date.getUTCMonth()];
  return `${m.charAt(0).toUpperCase() + m.slice(1)} ${date.getUTCFullYear()}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatHours(hours: number): string {
  if (Number.isInteger(hours)) return `${hours}h`;
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  if (whole === 0) return `${mins}m`;
  return `${whole}h ${mins}m`;
}

export function toUtcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addUtcDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function getMondayOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function getWeekdayShort(dow: number): string {
  return WEEKDAYS_SHORT_IT[dow] || '';
}

export function getWeekdayFull(dow: number): string {
  return WEEKDAYS_IT[dow] || '';
}

// ============================================================================
// MODULO INTEGRAZIONE WHATSAPP ZERO-COST (wa.me — SRS 4.2)
// ============================================================================

export function buildWhatsAppUrl(phoneE164: string, message: string): string {
  const digits = phoneE164.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * SRS 4.2.1/4.2.2 — Testo esatto promemoria lezione studente:
 * "Ciao [Nome], ti ricordiamo la tua lezione di [Titolo Corso] domani [Data] alle ore [Ora Inizio] presso [Nome Sala]. A presto!"
 */
export function buildStudentReminderMessage(params: {
  firstName: string;
  courseTitle: string;
  startTimeIso: string;
  roomName: string;
  isTomorrow?: boolean;
}): string {
  const data = formatDateNumeric(params.startTimeIso);
  const ora = formatTime(params.startTimeIso);
  const dayWord = params.isTomorrow === false ? `il ${data}` : `domani ${data}`;
  return `Ciao ${params.firstName}, ti ricordiamo la tua lezione di ${params.courseTitle} ${dayWord} alle ore ${ora} presso ${params.roomName}. A presto!`;
}

/**
 * SRS 4.2.3 — Promemoria turni insegnante (1-Click)
 */
export function buildTeacherShiftsMessage(teacherName: string, lessons: LessonSlot[]): string {
  const firstName = teacherName.split(' ')[0];
  if (lessons.length === 0) {
    return `Ciao ${firstName}, ti confermo che per domani non risultano turni programmati in studio. Buona giornata!`;
  }
  const lines = lessons.map(
    (l) => `• ${formatDateShort(l.start_time)} ore ${formatTimeRange(l.start_time, l.end_time)} — ${l.title} (${l.room_name}, ${l.active_bookings_count}/${l.max_capacity} iscritti)`
  );
  return `Ciao ${firstName}, ecco il riepilogo dei tuoi prossimi turni in studio:\n${lines.join('\n')}\nRicorda di confermare l'appello sull'app a fine lezione. Grazie!`;
}

/**
 * SRS 4.2.3 — Sollecito appello mancante insegnante (1-Click)
 */
export function buildTeacherValidationReminderMessage(
  teacherName: string,
  unvalidatedLessons: LessonSlot[]
): string {
  const firstName = teacherName.split(' ')[0];
  if (unvalidatedLessons.length === 1) {
    const l = unvalidatedLessons[0];
    return `Ciao ${firstName}, ti ricordo gentilmente di confermare e chiudere sull'app l'appello di "${l.title}" (${formatDateShort(l.start_time)} ore ${formatTime(l.start_time)}, ${l.room_name}). Grazie mille!`;
  }
  const lines = unvalidatedLessons
    .slice(0, 5)
    .map((l) => `• ${formatDateShort(l.start_time)} ${formatTime(l.start_time)} — ${l.title} (${l.room_name})`);
  return `Ciao ${firstName}, risultano ancora da validare sull'app questi appelli:\n${lines.join('\n')}\nAppena riesci puoi confermare le presenze? Grazie!`;
}

/**
 * Promemoria cortese rinnovo pacchetto in esaurimento
 */
export function buildPackageRenewalMessage(
  firstName: string,
  packageName: string,
  remainingCredits: number
): string {
  if (remainingCredits <= 0) {
    return `Ciao ${firstName}, ti informiamo che il tuo "${packageName}" si è concluso. Quando desideri possiamo rinnovarlo insieme in studio per riservare i tuoi prossimi posti. A presto!`;
  }
  const word = remainingCredits === 1 ? 'rimane 1 lezione disponibile' : `rimangono ${remainingCredits} lezioni disponibili`;
  return `Ciao ${firstName}, ti ricordiamo che nel tuo "${packageName}" ${word}. Scrivici pure se desideri già rinnovare e confermare i tuoi orari abituali. A presto!`;
}

/**
 * Promemoria cortese saldo pacchetto
 */
export function buildPaymentReminderMessage(
  firstName: string,
  packageName: string,
  balanceDue: number
): string {
  return `Ciao ${firstName}, ti ricordiamo gentilmente il saldo di ${formatCurrency(balanceDue)} relativo al "${packageName}" alla prossima lezione in studio. Grazie e a presto!`;
}

/**
 * SRS 4.2.4 — Generatore Broadcast Corsi Mirati & Slot Liberi
 */
export function buildTargetedBroadcastMessage(params: {
  studioName: string;
  targetedCourses: LessonSlot[];
  freeSlots: FreeSlotSuggestion[];
  publicBoardUrl?: string;
}): string {
  const parts: string[] = [
    `Ciao! Presso ${params.studioName} abbiamo attivato nuove disponibilità pomeridiane e corsi mirati di Pilates a numero chiuso:`,
    '',
  ];

  if (params.targetedCourses.length > 0) {
    parts.push('CORSI MIRATI ATTIVI:');
    for (const c of params.targetedCourses) {
      const rem = Math.max(0, c.max_capacity - c.active_bookings_count);
      parts.push(
        `• ${formatDateLong(c.start_time)} ore ${formatTimeRange(c.start_time, c.end_time)} — ${c.title} (${c.room_name} · ${rem} ${rem === 1 ? 'posto libero' : 'posti liberi'})`
      );
    }
    parts.push('');
  }

  if (params.freeSlots.length > 0) {
    parts.push('NUOVE FASCE DISPONIBILI SU PRENOTAZIONE:');
    for (const fs of params.freeSlots) {
      const roomNames = fs.available_rooms.map((r) => r.name).join(' / ');
      parts.push(
        `• ${formatDateLong(fs.date)} dalle ${formatTime(fs.start_time)} alle ${formatTime(fs.end_time)} (${roomNames})`
      );
    }
    parts.push('');
  }

  if (params.publicBoardUrl) {
    parts.push(`Consulta i posti aggiornati: ${params.publicBoardUrl}`);
  }
  parts.push('Rispondi a questo messaggio per riservare il tuo posto!');
  return parts.join('\n');
}

/**
 * Messaggio richiesta posto dalla Bacheca Pubblica (SRS 4.1)
 */
export function buildPublicInquiryMessage(course: PublicCourseSlot): string {
  return `Ciao! Ho visto sulla bacheca disponibilità il corso "${course.title}" di ${formatDateLong(course.start_time)} alle ore ${formatTime(course.start_time)} (${course.room_name}). Vorrei sapere se posso riservare un posto. Grazie!`;
}

// ============================================================================
// ETICHETTE STATI IN ITALIANO
// ============================================================================

export const ATTENDANCE_META: Record<
  AttendanceStatus,
  { label: string; shortLabel: string; bg: string; text: string; border: string }
> = {
  PENDING: {
    label: 'Da segnare',
    shortLabel: 'In attesa',
    bg: 'bg-[#F1ECE3]',
    text: 'text-[#625B52]',
    border: 'border-[#DED6C8]',
  },
  PRESENT: {
    label: 'Presente (scalata)',
    shortLabel: 'Presente',
    bg: 'bg-[#EAF4EE]',
    text: 'text-[#2F6649]',
    border: 'border-[#BDDAC8]',
  },
  ABSENT_PENDING_DECISION: {
    label: 'Assente · Da decidere',
    shortLabel: 'Assente',
    bg: 'bg-[#FCF4E6]',
    text: 'text-[#9A651C]',
    border: 'border-[#ECD4AA]',
  },
  ABSENT_DEDUCTED: {
    label: 'Assenza scalata',
    shortLabel: 'Scalata',
    bg: 'bg-[#FBECEB]',
    text: 'text-[#A63A31]',
    border: 'border-[#EBC3C0]',
  },
  ABSENT_FROZEN: {
    label: 'Assenza congelata',
    shortLabel: 'Congelata',
    bg: 'bg-[#EBF1F5]',
    text: 'text-[#3E5D73]',
    border: 'border-[#C1D4E0]',
  },
  RESCHEDULE_REQUESTED: {
    label: 'Spostamento richiesto',
    shortLabel: 'Da spostare',
    bg: 'bg-[#F1EFF6]',
    text: 'text-[#5A5070]',
    border: 'border-[#D4CEE2]',
  },
};

export const PAYMENT_META: Record<
  PaymentStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  PAID: {
    label: 'Saldato',
    bg: 'bg-[#EAF4EE]',
    text: 'text-[#2F6649]',
    border: 'border-[#BDDAC8]',
  },
  PARTIAL: {
    label: 'Acconto',
    bg: 'bg-[#FCF4E6]',
    text: 'text-[#9A651C]',
    border: 'border-[#ECD4AA]',
  },
  UNPAID: {
    label: 'Da saldare',
    bg: 'bg-[#FBECEB]',
    text: 'text-[#A63A31]',
    border: 'border-[#EBC3C0]',
  },
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  ATTENDANCE_VALIDATED: 'Appello Validato',
  CREDIT_DEDUCTED: 'Lezione Scalata',
  CREDIT_FROZEN: 'Lezione Congelata',
  RESCHEDULE_REQUESTED: 'Richiesta Spostamento',
  BOOKING_RESCHEDULED: 'Lezione Riprogrammata',
  LESSON_UNLOCKED: 'Appello Sbloccato',
  ATTENDANCE_UPDATED: 'Presenza Aggiornata',
  LESSON_CREATED: 'Corso Creato',
  LESSON_DELETED: 'Corso Rimosso',
  PACKAGE_CREATED: 'Pacchetto Emesso',
  PAYMENT_UPDATED: 'Pagamento Registrato',
  STUDENT_CREATED: 'Nuovo Studente',
  ROOM_CREATED: 'Nuova Sala',
  TEACHER_CREATED: 'Nuova Insegnante',
};
