import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Edit3,
  HeartPulse,
  Lock,
  LockOpen,
  MapPin,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Modal } from './Modal';
import { TrafficLightBadge, WhatsAppIcon } from './BrandMark';
import { apiFetch, launchWhatsApp } from '../lib/api';
import {
  ATTENDANCE_META,
  buildStudentReminderMessage,
  buildWhatsAppUrl,
  formatDateLong,
  formatDateTimeCompact,
  formatTime,
  formatTimeRange,
} from '../lib/format';
import type {
  AdminBookingView,
  AttendanceStatus,
  LessonSlot,
  Room,
  Student,
  TeacherSummary,
} from '../../shared/types';

interface LessonDetailModalProps {
  lesson: LessonSlot | null;
  rooms: Room[];
  teachers: TeacherSummary[];
  onClose: () => void;
  onChanged: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
  syncTick: number;
}

export function LessonDetailModal({
  lesson,
  rooms,
  teachers,
  onClose,
  onChanged,
  notify,
  syncTick,
}: LessonDetailModalProps) {
  const [bookings, setBookings] = useState<AdminBookingView[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Campi modifica corso
  const [editTitle, setEditTitle] = useState('');
  const [editRoomId, setEditRoomId] = useState('');
  const [editTeacherId, setEditTeacherId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editCap, setEditCap] = useState(6);
  const [editTargeted, setEditTargeted] = useState(false);
  const [editNotes, setEditNotes] = useState('');

  const loadDetails = useCallback(async () => {
    if (!lesson) return;
    setLoading(true);
    try {
      const [bRes, sRes] = await Promise.all([
        apiFetch<{ bookings: AdminBookingView[] }>(`/api/lessons/${lesson.id}/bookings`),
        apiFetch<{ students: Student[] }>('/api/students'),
      ]);
      setBookings(bRes.bookings);
      setStudents(sRes.students);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore caricamento iscritti.');
    } finally {
      setLoading(false);
    }
  }, [lesson, notify]);

  useEffect(() => {
    if (lesson) {
      setEditMode(false);
      setConfirmDelete(false);
      setSelectedStudentId('');
      setEditTitle(lesson.title);
      setEditRoomId(lesson.room_id);
      setEditTeacherId(lesson.teacher_id);
      setEditDate(lesson.start_time.slice(0, 10));
      setEditStart(formatTime(lesson.start_time));
      setEditEnd(formatTime(lesson.end_time));
      setEditCap(lesson.max_capacity);
      setEditTargeted(lesson.is_targeted);
      setEditNotes(lesson.notes || '');
      loadDetails();
    }
  }, [lesson?.id, loadDetails]);

  useEffect(() => {
    if (lesson && syncTick > 0) {
      loadDetails();
    }
  }, [syncTick]);

  if (!lesson) return null;

  const activeBookingsCount = bookings.filter(
    (b) => b.attendance_status !== 'ABSENT_FROZEN' && b.attendance_status !== 'RESCHEDULE_REQUESTED'
  ).length;
  const isFull = activeBookingsCount >= lesson.max_capacity;
  const pendingCount = bookings.filter((b) => b.attendance_status === 'PENDING').length;
  const bookedIds = new Set(bookings.map((b) => b.student_id));
  const availableStudents = students.filter(
    (s) =>
      !bookedIds.has(s.id) &&
      s.active_package &&
      s.active_package.remaining_credits > 0 &&
      s.active_package.status === 'ACTIVE'
  );

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentId) return;
    setBusyAction('add');
    try {
      await apiFetch(`/api/lessons/${lesson.id}/bookings`, {
        method: 'POST',
        body: JSON.stringify({ student_id: selectedStudentId }),
      });
      setSelectedStudentId('');
      notify('success', "Studente assegnato e sincronizzato in tempo reale con l'appello.");
      await loadDetails();
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile aggiungere studente.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStatusChange = async (bookingId: string, status: AttendanceStatus) => {
    setBusyAction(bookingId);
    try {
      await apiFetch(`/api/bookings/${bookingId}/attendance`, {
        method: 'PATCH',
        body: JSON.stringify({ attendance_status: status }),
      });
      await loadDetails();
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore aggiornamento stato.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveBooking = async (bookingId: string) => {
    setBusyAction(bookingId);
    try {
      await apiFetch(`/api/bookings/${bookingId}`, { method: 'DELETE' });
      notify('success', 'Iscritto rimosso dalla lezione.');
      await loadDetails();
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore rimozione iscritto.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleValidate = async () => {
    setBusyAction('validate');
    try {
      await apiFetch(`/api/lessons/${lesson.id}/validate`, { method: 'POST' });
      notify('success', 'Appello confermato e storicizzato.');
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile validare appello.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnlock = async () => {
    setBusyAction('unlock');
    try {
      await apiFetch(`/api/lessons/${lesson.id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Sblocco manuale Titolare per rettifica' }),
      });
      notify('success', "Appello sbloccato: l'insegnante può ora correggere le presenze.");
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore sblocco appello.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('edit');
    try {
      const startIso = `${editDate}T${editStart}:00.000Z`;
      const endIso = `${editDate}T${editEnd}:00.000Z`;
      await apiFetch(`/api/lessons/${lesson.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          room_id: editRoomId,
          teacher_id: editTeacherId,
          start_time: startIso,
          end_time: endIso,
          max_capacity: Number(editCap),
          is_targeted: editTargeted,
          notes: editNotes,
        }),
      });
      notify('success', 'Dettagli lezione aggiornati senza conflitti.');
      setEditMode(false);
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile salvare le modifiche.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteLesson = async () => {
    setBusyAction('delete');
    try {
      await apiFetch(`/api/lessons/${lesson.id}`, { method: 'DELETE' });
      notify('success', 'Lezione eliminata dal calendario.');
      onClose();
      onChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile eliminare la lezione.');
    } finally {
      setBusyAction(null);
    }
  };

  const pct = Math.min(100, Math.round((activeBookingsCount / lesson.max_capacity) * 100));

  return (
    <Modal
      open={Boolean(lesson)}
      onClose={onClose}
      title={lesson.title}
      subtitle={`${formatDateLong(lesson.start_time)} · ${formatTimeRange(lesson.start_time, lesson.end_time)}`}
      maxWidth="2xl"
    >
      {/* Intestazione metadati lezione */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#EFEAE1]">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F0E8] px-3 py-1 font-medium text-[#23201D]">
            <MapPin className="h-3.5 w-3.5 text-[#4A6759]" />
            {lesson.room_name}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F0E8] px-3 py-1 font-medium text-[#23201D]">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: lesson.teacher_color }}
            />
            {lesson.teacher_name}
          </span>
          {lesson.is_targeted && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EDF2EE] border border-[#C9DBD0] px-2.5 py-0.5 font-medium text-[#3B5448]">
              <Sparkles className="h-3 w-3" />
              Corso Mirato · Bacheca
            </span>
          )}
          <TrafficLightBadge status={lesson.traffic_light} />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2DACD] px-2.5 py-1.5 text-xs font-medium text-[#625B52] hover:bg-[#F4F0E8] hover:text-[#23201D] transition-colors"
          >
            <Edit3 className="h-3.5 w-3.5" />
            {editMode ? 'Torna ad Appello' : 'Modifica Corso'}
          </button>
        </div>
      </div>

      {editMode ? (
        <form onSubmit={handleSaveEdit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#625B52] mb-1">Titolo corso</label>
            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Sala</label>
              <select
                value={editRoomId}
                onChange={(e) => setEditRoomId(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              >
                {rooms
                  .filter((r) => r.is_active || r.id === lesson.room_id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} (cap. {r.default_capacity})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Insegnante</label>
              <select
                value={editTeacherId}
                onChange={(e) => setEditTeacherId(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              >
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-[#625B52] mb-1">Data</label>
              <input
                type="date"
                required
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Inizio</label>
              <input
                type="time"
                required
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Fine</label>
              <input
                type="time"
                required
                value={editEnd}
                onChange={(e) => setEditEnd(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-[#625B52] mb-1">Capienza max</label>
              <input
                type="number"
                min={Math.max(1, activeBookingsCount)}
                max={100}
                required
                value={editCap}
                onChange={(e) => setEditCap(Number(e.target.value))}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm tabular-nums focus:border-[#4A6759] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#625B52] mb-1">
              Note operative / descrizione corso
            </label>
            <textarea
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Es. Focus mobilità colonna, livello intermedio..."
              className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2 text-sm focus:border-[#4A6759] focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2.5 rounded-xl border border-[#E8E2D9] bg-[#F8F6F2] px-3.5 py-2.5 text-sm text-[#23201D]">
            <input
              type="checkbox"
              checked={editTargeted}
              onChange={(e) => setEditTargeted(e.target.checked)}
              className="h-4 w-4 accent-[#4A6759]"
            />
            <span>
              Pubblica come <strong>Corso Mirato</strong> nella Bacheca Disponibilità Pubblica
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EFEAE1]">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-[#A63A31] hover:bg-[#FBECEB] transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Elimina lezione
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#A63A31] font-medium">Confermi eliminazione?</span>
                <button
                  type="button"
                  disabled={busyAction === 'delete'}
                  onClick={handleDeleteLesson}
                  className="rounded-lg bg-[#B5443A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#99352C]"
                >
                  Sì, elimina
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-[#DED6C8] px-2.5 py-1.5 text-xs text-[#625B52]"
                >
                  Annulla
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={busyAction === 'edit'}
              className="rounded-xl bg-[#4A6759] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#3A5347] transition-colors disabled:opacity-50"
            >
              {busyAction === 'edit' ? 'Verifica conflitti...' : 'Salva Modifiche'}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 space-y-5">
          {/* Contatore Capienza in tempo reale (SRS 3.1.3) */}
          <div className="rounded-xl bg-[#F8F6F2] border border-[#EAE4DA] p-3.5">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="inline-flex items-center gap-1.5 font-medium text-[#23201D]">
                <Users className="h-4 w-4 text-[#4A6759]" />
                Posti occupati / Capienza massima
              </span>
              <span
                className={`font-semibold tabular-nums text-sm ${
                  isFull ? 'text-[#B5443A]' : 'text-[#4A6759]'
                }`}
              >
                {activeBookingsCount} / {lesson.max_capacity}
                {isFull ? ' · Completo' : ` · ${lesson.max_capacity - activeBookingsCount} liberi`}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#E6DFD3] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isFull ? 'bg-[#B86B52]' : 'bg-[#4A6759]'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {lesson.notes && (
              <p className="mt-2.5 text-xs text-[#625B52] leading-relaxed">{lesson.notes}</p>
            )}
          </div>

          {/* Assegnazione Studente (solo se appello non validato e capienza disponibile) */}
          {!lesson.is_validated && (
            <form onSubmit={handleAddStudent} className="flex flex-col sm:flex-row gap-2">
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                disabled={isFull}
                className="flex-1 rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm text-[#23201D] focus:border-[#4A6759] focus:outline-none disabled:opacity-50"
              >
                <option value="">
                  {isFull
                    ? 'Capienza massima raggiunta — nessun posto disponibile'
                    : availableStudents.length === 0
                      ? 'Nessun altro studente con pacchetto attivo disponibile'
                      : 'Assegna studente alla lezione (credito scalato solo a validazione)...'}
                </option>
                {availableStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name} — {s.active_package?.name} (
                    {s.active_package?.remaining_credits} residui)
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!selectedStudentId || isFull || busyAction === 'add'}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4A6759] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3A5347] transition-colors disabled:opacity-40"
              >
                <UserPlus className="h-4 w-4" />
                Assegna
              </button>
            </form>
          )}

          {/* Lista Iscritti & Stato Presenze */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8E867B]">
                Lista Appello &amp; Iscritti ({bookings.length})
              </h3>
              {lesson.is_validated && lesson.validated_at && (
                <span className="inline-flex items-center gap-1 text-xs text-[#2F6649]">
                  <Lock className="h-3.5 w-3.5" />
                  Validato il {formatDateTimeCompact(lesson.validated_at)}
                  {lesson.validated_by_name ? ` da ${lesson.validated_by_name}` : ''}
                </span>
              )}
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-[#8E867B]">Caricamento iscritti...</div>
            ) : bookings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#DED6C8] py-8 text-center text-sm text-[#8E867B]">
                Nessuno studente ancora assegnato a questa lezione.
              </div>
            ) : (
              <div className="space-y-2.5">
                {bookings.map((b) => {
                  const meta = ATTENDANCE_META[b.attendance_status];
                  const waUrl = buildWhatsAppUrl(
                    b.student_phone,
                    buildStudentReminderMessage({
                      firstName: b.student_first_name,
                      courseTitle: lesson.title,
                      startTimeIso: lesson.start_time,
                      roomName: lesson.room_name,
                    })
                  );

                  return (
                    <div
                      key={b.id}
                      className="rounded-xl border border-[#EAE4DA] bg-white p-3.5 transition-colors hover:border-[#D8CFC2]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-sm text-[#23201D]">
                              {b.student_first_name} {b.student_last_name}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.bg} ${meta.text} ${meta.border}`}
                            >
                              {meta.label}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-[#625B52] tabular-nums">
                            {b.package_name} ·{' '}
                            <strong
                              className={
                                b.package_remaining_credits <= 2
                                  ? 'text-[#B5443A]'
                                  : 'text-[#23201D]'
                              }
                            >
                              {b.package_remaining_credits}/{b.package_total_credits} lezioni residue
                            </strong>
                          </p>
                          {b.student_medical_notes && (
                            <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-lg bg-[#FCF4E6] px-2.5 py-1 text-xs text-[#8A5A19]">
                              <HeartPulse className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>{b.student_medical_notes}</span>
                            </p>
                          )}
                          {b.reschedule_note && (
                            <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-lg bg-[#F1EFF6] px-2.5 py-1 text-xs text-[#5A5070]">
                              <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>Nota spostamento: {b.reschedule_note}</span>
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              launchWhatsApp({
                                phone: b.student_phone,
                                recipientName: `${b.student_first_name} ${b.student_last_name}`,
                                contextLabel: `Promemoria lezione · ${lesson.title}`,
                                message: buildStudentReminderMessage({
                                  firstName: b.student_first_name,
                                  courseTitle: lesson.title,
                                  startTimeIso: lesson.start_time,
                                  roomName: lesson.room_name,
                                }),
                              })
                            }
                            title="Invia promemoria su WhatsApp"
                            className="inline-flex items-center gap-1 rounded-lg border border-[#C9DBD0] bg-[#EDF2EE] px-2.5 py-1.5 text-xs font-medium text-[#2F6649] hover:bg-[#DFECE3] transition-colors"
                          >
                            <WhatsAppIcon className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Promemoria</span>
                          </button>
                          {!lesson.is_validated && (
                            <button
                              type="button"
                              onClick={() => handleRemoveBooking(b.id)}
                              disabled={busyAction === b.id}
                              title="Rimuovi dalla lezione"
                              className="rounded-lg p-1.5 text-[#8E867B] hover:bg-[#FBECEB] hover:text-[#A63A31] transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Azioni rapide stato presenza / gestione assenze Titolare */}
                      <div className="mt-2.5 pt-2.5 border-t border-[#F4F0E8] flex flex-wrap gap-1.5">
                        {(
                          [
                            { st: 'PRESENT', label: 'Presente' },
                            { st: 'ABSENT_DEDUCTED', label: 'Assente · Scala' },
                            { st: 'ABSENT_FROZEN', label: 'Assente · Congela' },
                            { st: 'RESCHEDULE_REQUESTED', label: 'Da Spostare' },
                          ] as { st: AttendanceStatus; label: string }[]
                        ).map((opt) => {
                          const active = b.attendance_status === opt.st;
                          return (
                            <button
                              key={opt.st}
                              type="button"
                              disabled={busyAction === b.id}
                              onClick={() => handleStatusChange(b.id, opt.st)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                                active
                                  ? 'bg-[#23201D] text-white'
                                  : 'bg-[#F8F6F2] text-[#625B52] hover:bg-[#EDE6DA] hover:text-[#23201D]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Blocco / Sblocco Appello (SRS 3.2.4) */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#EFEAE1]">
            {lesson.is_validated ? (
              <>
                <p className="text-xs text-[#625B52]">
                  L&apos;appello è bloccato in sola lettura per l&apos;insegnante.
                </p>
                <button
                  type="button"
                  disabled={busyAction === 'unlock'}
                  onClick={handleUnlock}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#D8B4A6] bg-[#F9EFEA] px-4 py-2.5 text-sm font-medium text-[#9A4B34] hover:bg-[#F3E2D9] transition-colors"
                >
                  <LockOpen className="h-4 w-4" />
                  Sblocca Appello
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-[#625B52]">
                  {pendingCount > 0
                    ? `${pendingCount} ${pendingCount === 1 ? 'studente ancora' : 'studenti ancora'} in stato "Da segnare".`
                    : 'Tutti gli studenti hanno un esito registrato.'}
                </p>
                <button
                  type="button"
                  disabled={bookings.length === 0 || pendingCount > 0 || busyAction === 'validate'}
                  onClick={handleValidate}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#4A6759] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3A5347] transition-colors disabled:opacity-40"
                >
                  <Check className="h-4 w-4" />
                  Conferma e Chiudi Appello
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
