import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  Calendar,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  HeartPulse,
  Lock,
  LogOut,
  MapPin,
  RefreshCw,
  RotateCcw,
  Smartphone,
  UserX,
  Users,
  Wifi,
} from 'lucide-react';
import { BrandMark, TrafficLightBadge } from '../../components/BrandMark';
import { apiFetch, copyTextToClipboard } from '../../lib/api';
import {
  ATTENDANCE_META,
  addUtcDays,
  formatDateLong,
  formatDateShort,
  formatDateTimeCompact,
  formatHours,
  formatMonthYear,
  formatTime,
  formatTimeRange,
  getMondayOfWeek,
  toUtcDateString,
} from '../../lib/format';
import {
  isIosDevice,
  isStandalonePwa,
  subscribeToWebPush,
  unsubscribeFromWebPush,
  type BeforeInstallPromptEvent,
} from '../../lib/pwa';
import type {
  AttendanceStatus,
  AuthUser,
  LessonSlot,
  Room,
  StaffBookingView,
} from '../../../shared/types';

interface StaffSummaryResponse {
  unvalidated_past_lessons: LessonSlot[];
  today_lessons: LessonSlot[];
  monthly_validated_hours: number;
  monthly_validated_lessons: number;
}

interface StaffPortalProps {
  user: AuthUser;
  onUserUpdated: (u: AuthUser) => void;
  onLogout: () => void;
  wsConnected: boolean;
  syncTick: number;
  installPrompt: BeforeInstallPromptEvent | null;
  onTriggerInstall: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}

export function StaffPortal({
  user,
  onUserUpdated,
  onLogout,
  wsConnected,
  syncTick,
  installPrompt,
  onTriggerInstall,
  notify,
}: StaffPortalProps) {
  const [tab, setTab] = useState<'rollcall' | 'calendar' | 'notifications'>('rollcall');
  const [summary, setSummary] = useState<StaffSummaryResponse | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [bookingsMap, setBookingsMap] = useState<Record<string, StaffBookingView[]>>({});
  const [loadingBookingsId, setLoadingBookingsId] = useState<string | null>(null);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [rescheduleDrafts, setRescheduleDrafts] = useState<Record<string, string>>({});

  // Calendario docente + coordinamento sale
  const [calScope, setCalScope] = useState<'mine' | 'all_rooms'>('mine');
  const [weekMonday, setWeekMonday] = useState<string>(() =>
    getMondayOfWeek(toUtcDateString(new Date()))
  );
  const [weekLessons, setWeekLessons] = useState<LessonSlot[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // Notifiche Push & Sync Calendario
  const [pushBusy, setPushBusy] = useState(false);

  const loadBookings = useCallback(
    async (lessonId: string) => {
      setLoadingBookingsId(lessonId);
      try {
        const res = await apiFetch<{ bookings: StaffBookingView[] }>(
          `/api/lessons/${lessonId}/bookings`
        );
        setBookingsMap((prev) => ({ ...prev, [lessonId]: res.bookings }));
        const notes: Record<string, string> = {};
        for (const b of res.bookings) {
          if (b.reschedule_note) notes[b.id] = b.reschedule_note;
        }
        setRescheduleDrafts((prev) => ({ ...prev, ...notes }));
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Impossibile caricare la lista appello.');
      } finally {
        setLoadingBookingsId(null);
      }
    },
    [notify]
  );

  const loadSummary = useCallback(async () => {
    try {
      const res = await apiFetch<StaffSummaryResponse>('/api/staff/summary');
      setSummary(res);
      // Apri automaticamente il primo appello non validato o la prima lezione di oggi (Regola dei 2 Tocchi!)
      setExpandedLessonId((current) => {
        if (current) return current;
        const firstUrgent =
          res.unvalidated_past_lessons[0] ||
          res.today_lessons.find((l) => !l.is_validated) ||
          res.today_lessons[0];
        return firstUrgent ? firstUrgent.id : null;
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore caricamento agenda.');
    }
  }, [notify]);

  const loadCalendar = useCallback(async () => {
    const fromIso = `${weekMonday}T00:00:00.000Z`;
    const toIso = `${addUtcDays(weekMonday, 7)}T00:00:00.000Z`;
    const q = new URLSearchParams({ from: fromIso, to: toIso });
    if (calScope === 'mine') q.set('teacherId', user.id);

    try {
      const [lRes, rRes] = await Promise.all([
        apiFetch<{ lessons: LessonSlot[] }>(`/api/lessons?${q.toString()}`),
        apiFetch<{ rooms: Room[] }>('/api/rooms'),
      ]);
      setWeekLessons(lRes.lessons);
      setRooms(rRes.rooms);
    } catch {
      // ignore transient
    }
  }, [weekMonday, calScope, user.id]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (expandedLessonId) {
      loadBookings(expandedLessonId);
    }
  }, [expandedLessonId, loadBookings]);

  useEffect(() => {
    if (tab === 'calendar') {
      loadCalendar();
    }
  }, [tab, loadCalendar]);

  // Real-time WebSocket refresh: aggiorna istantaneamente la lista appello senza ricaricare la pagina!
  useEffect(() => {
    if (syncTick === 0) return;
    loadSummary();
    if (expandedLessonId) loadBookings(expandedLessonId);
    if (tab === 'calendar') loadCalendar();
  }, [syncTick]);

  const handleMarkAttendance = async (
    lessonId: string,
    bookingId: string,
    status: AttendanceStatus,
    note?: string
  ) => {
    setBusyBookingId(bookingId);
    try {
      await apiFetch(`/api/bookings/${bookingId}/attendance`, {
        method: 'PATCH',
        body: JSON.stringify({
          attendance_status: status,
          ...(note !== undefined ? { reschedule_note: note } : {}),
        }),
      });
      await Promise.all([loadBookings(lessonId), loadSummary()]);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile aggiornare la presenza.');
    } finally {
      setBusyBookingId(null);
    }
  };

  const handleCloseRollCall = async (lesson: LessonSlot) => {
    setValidatingId(lesson.id);
    try {
      await apiFetch(`/api/lessons/${lesson.id}/validate`, { method: 'POST' });
      notify('success', `Appello di "${lesson.title}" confermato e storicizzato.`);
      await Promise.all([loadSummary(), loadBookings(lesson.id)]);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore chiusura appello.');
    } finally {
      setValidatingId(null);
    }
  };

  const handleTogglePush = async () => {
    setPushBusy(true);
    try {
      if (user.has_push_subscription) {
        await unsubscribeFromWebPush();
        onUserUpdated({ ...user, has_push_subscription: false });
        notify('info', 'Notifiche Web Push disattivate su questo dispositivo.');
      } else {
        const res = await subscribeToWebPush();
        if (res.ok) {
          onUserUpdated({ ...user, has_push_subscription: true });
          notify('success', res.message);
        } else {
          notify('error', res.message);
        }
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore configurazione Web Push.');
    } finally {
      setPushBusy(false);
    }
  };

  const handleTestPush = async () => {
    setPushBusy(true);
    try {
      await apiFetch('/api/push/test', { method: 'POST' });
      notify('info', 'Notifica di prova inviata al dispositivo.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore invio notifica di prova.');
    } finally {
      setPushBusy(false);
    }
  };

  const handleRegenerateCalendarToken = async () => {
    try {
      const res = await apiFetch<{ google_calendar_token: string }>(
        '/api/calendar/regenerate-token',
        { method: 'POST' }
      );
      onUserUpdated({ ...user, google_calendar_token: res.google_calendar_token });
      notify('success', 'Link calendario rigenerato.');
    } catch {
      notify('error', 'Impossibile rigenerare il link calendario.');
    }
  };

  const unvalidatedList = summary?.unvalidated_past_lessons || [];
  const todayList = summary?.today_lessons || [];
  const todayIds = new Set(todayList.map((l) => l.id));
  const previousUnvalidated = unvalidatedList.filter((l) => !todayIds.has(l.id));
  const totalPendingStudents = unvalidatedList.reduce((a, l) => a + l.pending_students_count, 0);

  const openLessonCard = (lesson: LessonSlot) => {
    if (lesson.teacher_id !== user.id) return;
    setTab('rollcall');
    setExpandedLessonId(lesson.id);
  };

  const icsHttpsUrl = user.google_calendar_token
    ? `${window.location.origin}/api/calendar/${user.google_calendar_token}/feed.ics`
    : '';
  const webcalUrl = icsHttpsUrl.replace(/^https?:\/\//, 'webcal://');
  const googleCalSubscribeUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
    webcalUrl
  )}`;

  const renderLessonRollCallCard = (lesson: LessonSlot) => {
    const isOpen = expandedLessonId === lesson.id;
    const rows = bookingsMap[lesson.id] || [];
    const isLoadingRows = loadingBookingsId === lesson.id && !bookingsMap[lesson.id];
    const pendingInCard = rows.filter((r) => r.attendance_status === 'PENDING').length;
    const markedInCard = rows.length - pendingInCard;

    return (
      <article
        key={lesson.id}
        className={`rounded-2xl border bg-white transition-all overflow-hidden ${
          lesson.traffic_light === 'RED'
            ? 'border-[#E5B4B0] shadow-xs'
            : isOpen
              ? 'border-[#4A6759] shadow-sm'
              : 'border-[#E8E2D9]'
        }`}
      >
        {/* Tocco 1: Apertura card lezione */}
        <button
          type="button"
          onClick={() => setExpandedLessonId(isOpen ? null : lesson.id)}
          className="w-full text-left px-4 sm:px-5 py-4 flex items-start justify-between gap-3 hover:bg-[#FCFBF9] transition-colors"
        >
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#4A6759] px-2.5 py-0.5 text-xs font-semibold text-white tabular-nums">
                <Clock className="h-3 w-3" />
                {formatTimeRange(lesson.start_time, lesson.end_time)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F1ECE3] px-2.5 py-0.5 text-xs font-semibold text-[#23201D]">
                <MapPin className="h-3 w-3 text-[#4A6759]" />
                {lesson.room_name}
              </span>
              {lesson.start_time.slice(0, 10) !== toUtcDateString(new Date()) && (
                <span className="rounded-full bg-[#FBECEB] px-2.5 py-0.5 text-xs font-medium text-[#A63A31]">
                  {formatDateShort(lesson.start_time)}
                </span>
              )}
            </div>

            <h3 className="font-display text-2xl font-semibold text-[#23201D] leading-tight">
              {lesson.title}
            </h3>

            <p className="text-xs text-[#625B52] flex items-center gap-3 tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5 text-[#8E867B]" />
                {lesson.active_bookings_count}/{lesson.max_capacity} iscritti
              </span>
              {lesson.pending_students_count > 0 && !lesson.is_validated && (
                <span className="text-[#A63A31] font-medium">
                  · {lesson.pending_students_count} da segnare
                </span>
              )}
            </p>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-2">
            <TrafficLightBadge status={lesson.traffic_light} />
            <span className="text-[11px] font-medium text-[#4A6759]">
              {isOpen ? 'Riduci' : lesson.is_validated ? 'Vedi appello' : 'Apri appello'}
            </span>
          </div>
        </button>

        {/* Tocco 2: Lista studenti con nomi grandi e 3 pulsanti chiari (Presente, Assente, Sposta) */}
        {isOpen && (
          <div className="border-t border-[#EFEAE1] bg-[#FAF8F4] px-4 sm:px-5 py-4 space-y-3">
            {lesson.notes && (
              <p className="rounded-xl bg-white border border-[#EAE4DA] px-3.5 py-2 text-xs text-[#625B52]">
                <strong className="text-[#23201D]">Nota corso:</strong> {lesson.notes}
              </p>
            )}

            {lesson.is_validated && (
              <div className="flex items-center gap-2 rounded-xl bg-[#EAF4EE] border border-[#BDDAC8] px-3.5 py-2.5 text-xs text-[#2F6649]">
                <Lock className="h-4 w-4 shrink-0" />
                <span>
                  Appello confermato e bloccato in sola lettura
                  {lesson.validated_at ? ` (${formatDateTimeCompact(lesson.validated_at)})` : ''}.
                  Per eventuali rettifiche rivolgiti alla Titolare.
                </span>
              </div>
            )}

            {isLoadingRows ? (
              <div className="py-6 text-center text-sm text-[#8E867B]">
                Caricamento iscritti...
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-xl bg-white border border-dashed border-[#DED6C8] py-6 text-center text-sm text-[#8E867B]">
                Nessuno studente assegnato a questa lezione.
              </div>
            ) : (
              <div className="space-y-2.5">
                {rows.map((st) => {
                  const isPresent = st.attendance_status === 'PRESENT';
                  const isAbsent =
                    st.attendance_status === 'ABSENT_PENDING_DECISION' ||
                    st.attendance_status === 'ABSENT_DEDUCTED' ||
                    st.attendance_status === 'ABSENT_FROZEN';
                  const isReschedule = st.attendance_status === 'RESCHEDULE_REQUESTED';
                  const lockedByAdmin =
                    lesson.is_validated ||
                    st.attendance_status === 'ABSENT_DEDUCTED' ||
                    st.attendance_status === 'ABSENT_FROZEN';
                  const isBusy = busyBookingId === st.id;
                  const meta = ATTENDANCE_META[st.attendance_status];

                  return (
                    <div
                      key={st.id}
                      className="rounded-2xl bg-white border border-[#E8E2D9] p-3.5 sm:p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-base sm:text-lg font-semibold text-[#23201D] leading-snug">
                            {st.student_first_name} {st.student_last_name}
                          </p>
                          {st.student_medical_notes && (
                            <div className="mt-1.5 flex items-start gap-1.5 rounded-xl bg-[#FCF4E6] border border-[#F0DCBA] px-3 py-1.5 text-xs text-[#8A5A19]">
                              <HeartPulse className="h-4 w-4 shrink-0 mt-0.5 text-[#B86B52]" />
                              <span className="leading-snug">{st.student_medical_notes}</span>
                            </div>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${meta.bg} ${meta.text} ${meta.border}`}
                        >
                          {meta.shortLabel}
                        </span>
                      </div>

                      {/* 3 pulsanti grandi e immediati (SRS 3.2.2 & 4.3) */}
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={lockedByAdmin || isBusy}
                          onClick={() => handleMarkAttendance(lesson.id, st.id, 'PRESENT')}
                          className={`flex items-center justify-center gap-1.5 rounded-xl py-3 px-2 text-xs sm:text-sm font-semibold border transition-all disabled:opacity-55 ${
                            isPresent
                              ? 'bg-[#3D7A5A] text-white border-[#3D7A5A] shadow-xs'
                              : 'bg-[#F8F6F2] text-[#23201D] border-[#E2DACD] hover:border-[#3D7A5A]'
                          }`}
                        >
                          <Check className="h-4 w-4" />
                          Presente
                        </button>

                        <button
                          type="button"
                          disabled={lockedByAdmin || isBusy}
                          onClick={() =>
                            handleMarkAttendance(lesson.id, st.id, 'ABSENT_PENDING_DECISION')
                          }
                          className={`flex items-center justify-center gap-1.5 rounded-xl py-3 px-2 text-xs sm:text-sm font-semibold border transition-all disabled:opacity-55 ${
                            isAbsent
                              ? 'bg-[#B86B52] text-white border-[#B86B52] shadow-xs'
                              : 'bg-[#F8F6F2] text-[#23201D] border-[#E2DACD] hover:border-[#B86B52]'
                          }`}
                        >
                          <UserX className="h-4 w-4" />
                          Assente
                        </button>

                        <button
                          type="button"
                          disabled={lockedByAdmin || isBusy}
                          onClick={() =>
                            handleMarkAttendance(
                              lesson.id,
                              st.id,
                              'RESCHEDULE_REQUESTED',
                              rescheduleDrafts[st.id] || ''
                            )
                          }
                          className={`flex items-center justify-center gap-1.5 rounded-xl py-3 px-2 text-xs sm:text-sm font-semibold border transition-all disabled:opacity-55 ${
                            isReschedule
                              ? 'bg-[#5A5070] text-white border-[#5A5070] shadow-xs'
                              : 'bg-[#F8F6F2] text-[#23201D] border-[#E2DACD] hover:border-[#5A5070]'
                          }`}
                        >
                          <RotateCcw className="h-4 w-4" />
                          Sposta
                        </button>
                      </div>

                      {/* Campo nota opzionale per spostamento */}
                      {isReschedule && (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            disabled={lesson.is_validated}
                            value={rescheduleDrafts[st.id] || ''}
                            onChange={(e) =>
                              setRescheduleDrafts((prev) => ({
                                ...prev,
                                [st.id]: e.target.value,
                              }))
                            }
                            placeholder="Nota opzionale per la Titolare (es. chiede recupero giovedì)..."
                            className="flex-1 rounded-xl border border-[#D4CEE2] bg-[#FAF9FC] px-3 py-2 text-xs text-[#23201D] focus:border-[#5A5070] focus:outline-none disabled:opacity-65"
                          />
                          {!lesson.is_validated && (
                            <button
                              type="button"
                              onClick={() =>
                                handleMarkAttendance(
                                  lesson.id,
                                  st.id,
                                  'RESCHEDULE_REQUESTED',
                                  rescheduleDrafts[st.id] || ''
                                )
                              }
                              className="rounded-xl bg-[#5A5070] px-3 py-2 text-xs font-medium text-white hover:bg-[#49405C]"
                            >
                              Salva nota
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pulsante finale "Conferma e Chiudi Appello" (SRS 4.3) */}
            {!lesson.is_validated && rows.length > 0 && (
              <div className="pt-2">
                <button
                  type="button"
                  disabled={pendingInCard > 0 || validatingId === lesson.id}
                  onClick={() => handleCloseRollCall(lesson)}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#4A6759] px-5 py-3.5 text-sm font-semibold text-white shadow-xs hover:bg-[#3A5347] transition-all disabled:bg-[#C9C2B7] disabled:text-white"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  {validatingId === lesson.id
                    ? 'Chiusura in corso...'
                    : pendingInCard > 0
                      ? `Conferma e Chiudi Appello (${markedInCard}/${rows.length} segnati)`
                      : 'Conferma e Chiudi Appello'}
                </button>
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  // Giorni della settimana per vista Calendario
  const weekDays = Array.from({ length: 6 }, (_, idx) => addUtcDays(weekMonday, idx));

  return (
    <div className="min-h-dvh bg-[#F8F6F2] pb-24">
      {/* Topbar Mobile-First */}
      <header className="sticky top-0 z-30 border-b border-[#E8E2D9] bg-white/92 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandMark size={36} />
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold text-[#23201D] leading-none truncate">
                {user.full_name}
              </p>
              <p className="mt-0.5 text-[11px] text-[#625B52] flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    wsConnected ? 'bg-[#3D7A5A]' : 'bg-[#C4862D]'
                  }`}
                />
                <span>Profilo Insegnante · {wsConnected ? 'Live Sync' : 'Riconnessione'}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2DACD] px-3 py-1.5 text-xs font-medium text-[#625B52] hover:bg-[#F4F0E8] hover:text-[#23201D] transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Esci
          </button>
        </div>

        {/* BANNER ROSSO PERSISTENTE ANTI-DIMENTICANZA (SRS 4.3) */}
        {unvalidatedList.length > 0 && (
          <div className="bg-[#B5443A] text-white">
            <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs sm:text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[#FAD6D2]" />
                <span>
                  <strong>
                    {unvalidatedList.length}{' '}
                    {unvalidatedList.length === 1
                      ? 'appello passato non validato'
                      : 'appelli passati non validati'}
                  </strong>
                  {totalPendingStudents > 0
                    ? ` (${totalPendingStudents} studenti da segnare)`
                    : ' — da chiudere'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTab('rollcall');
                  setExpandedLessonId(unvalidatedList[0].id);
                }}
                className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#A63A31] hover:bg-[#FBECEB] transition-colors"
              >
                Completa ora
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* TAB 1: OGGI & APPELLI RAPIDI */}
        {tab === 'rollcall' && (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#8E867B]">
                  Agenda Personale
                </p>
                <h1 className="font-display text-3xl font-semibold text-[#23201D]">
                  {formatDateLong(toUtcDateString(new Date()))}
                </h1>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-[#8E867B]">Ore validate mese</p>
                <p className="text-lg font-bold text-[#4A6759] tabular-nums">
                  {formatHours(summary?.monthly_validated_hours || 0)}
                </p>
              </div>
            </div>

            {/* Eventuali appelli di giorni precedenti rimasti aperti */}
            {previousUnvalidated.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#A63A31]">
                  Appelli Precedenti da Chiudere ({previousUnvalidated.length})
                </h2>
                {previousUnvalidated.map(renderLessonRollCallCard)}
              </section>
            )}

            {/* Corsi di oggi assegnati all'insegnante */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#625B52]">
                I Tuoi Corsi di Oggi ({todayList.length})
              </h2>
              {todayList.length === 0 ? (
                <div className="rounded-2xl border border-[#E8E2D9] bg-white p-8 text-center">
                  <p className="font-display text-2xl text-[#23201D]">
                    Nessun turno assegnato per oggi
                  </p>
                  <p className="mt-1 text-xs text-[#8E867B]">
                    Consulta la scheda Calendario Sale per vedere i tuoi prossimi corsi della
                    settimana.
                  </p>
                </div>
              ) : (
                todayList.map(renderLessonRollCallCard)
              )}
            </section>
          </>
        )}

        {/* TAB 2: CALENDARIO MIEI CORSI + TUTTE LE SALE (SRS 4.3) */}
        {tab === 'calendar' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-[#8E867B]">
                  Coordinamento Sale
                </p>
                <h1 className="font-display text-3xl font-semibold text-[#23201D]">
                  Calendario Settimanale
                </h1>
              </div>

              <div className="inline-flex rounded-xl bg-[#EFEAE1] p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setCalScope('mine')}
                  className={`rounded-lg px-3 py-1.5 transition-all ${
                    calScope === 'mine' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
                  }`}
                >
                  I Miei Corsi
                </button>
                <button
                  type="button"
                  onClick={() => setCalScope('all_rooms')}
                  className={`rounded-lg px-3 py-1.5 transition-all ${
                    calScope === 'all_rooms'
                      ? 'bg-white text-[#23201D] shadow-xs'
                      : 'text-[#625B52]'
                  }`}
                >
                  Tutte le Sale
                </button>
              </div>
            </div>

            {/* Legenda Sale disponibili */}
            {rooms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {rooms.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[#E8E2D9] px-3 py-1 text-xs text-[#625B52]"
                  >
                    <MapPin className="h-3 w-3 text-[#4A6759]" />
                    <strong className="text-[#23201D]">{r.name}</strong> · max {r.default_capacity}
                  </span>
                ))}
              </div>
            )}

            {/* Navigazione settimana */}
            <div className="flex items-center justify-between rounded-2xl border border-[#E8E2D9] bg-white px-3 py-2.5">
              <button
                type="button"
                onClick={() => setWeekMonday(addUtcDays(weekMonday, -7))}
                className="rounded-lg p-2 text-[#625B52] hover:bg-[#F4F0E8]"
                aria-label="Settimana precedente"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-[#23201D]">
                  {formatDateShort(weekMonday)} – {formatDateShort(addUtcDays(weekMonday, 5))}
                </p>
                <button
                  type="button"
                  onClick={() => setWeekMonday(getMondayOfWeek(toUtcDateString(new Date())))}
                  className="text-[11px] text-[#4A6759] hover:underline"
                >
                  Torna a questa settimana
                </button>
              </div>
              <button
                type="button"
                onClick={() => setWeekMonday(addUtcDays(weekMonday, 7))}
                className="rounded-lg p-2 text-[#625B52] hover:bg-[#F4F0E8]"
                aria-label="Settimana successiva"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Elenco per giorno con Sala evidenziata */}
            <div className="space-y-4">
              {weekDays.map((dayStr) => {
                const daySlots = weekLessons.filter((l) => l.start_time.slice(0, 10) === dayStr);
                const isToday = dayStr === toUtcDateString(new Date());
                return (
                  <div
                    key={dayStr}
                    className={`rounded-2xl border bg-white p-4 ${
                      isToday ? 'border-[#4A6759]' : 'border-[#E8E2D9]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <h3 className="text-sm font-semibold text-[#23201D]">
                        {formatDateLong(dayStr)}
                      </h3>
                      {isToday && (
                        <span className="rounded-full bg-[#EDF2EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#4A6759]">
                          Oggi
                        </span>
                      )}
                    </div>

                    {daySlots.length === 0 ? (
                      <p className="text-xs text-[#8E867B]">Nessuna lezione in programma.</p>
                    ) : (
                      <div className="space-y-2">
                        {daySlots.map((slot) => {
                          const isMine = slot.teacher_id === user.id;
                          return (
                            <div
                              key={slot.id}
                              onClick={() => isMine && openLessonCard(slot)}
                              className={`rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                                isMine
                                  ? 'border-[#DCE5DF] bg-[#F7FAF8] hover:border-[#4A6759] cursor-pointer'
                                  : 'border-[#EFEAE1] bg-[#FAF8F5] opacity-80'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="font-semibold text-[#23201D] tabular-nums">
                                    {formatTimeRange(slot.start_time, slot.end_time)}
                                  </span>
                                  <span className="rounded-md bg-white border border-[#E2DACD] px-2 py-0.5 font-medium text-[#4A6759]">
                                    {slot.room_name}
                                  </span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-[#23201D] truncate">
                                  {slot.title}
                                </p>
                                <p className="text-xs text-[#625B52] flex items-center gap-1.5 mt-0.5">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: slot.teacher_color }}
                                  />
                                  <span>{isMine ? 'Tuo turno' : slot.teacher_name}</span>
                                  <span className="tabular-nums">
                                    · {slot.active_bookings_count}/{slot.max_capacity} posti
                                  </span>
                                </p>
                              </div>
                              {isMine && <TrafficLightBadge status={slot.traffic_light} />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: NOTIFICHE WEB PUSH, GOOGLE CALENDAR & MONTE ORE (SRS 3.3, 4.3, 5) */}
        {tab === 'notifications' && (
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-[#8E867B]">
                Promemoria &amp; Riepilogo
              </p>
              <h1 className="font-display text-3xl font-semibold text-[#23201D]">
                Notifiche &amp; Calendario
              </h1>
            </div>

            {/* Riepilogo Monte Ore Operativo Mensile (zero campi economici per SRS 3.3) */}
            <section className="rounded-2xl border border-[#E8E2D9] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#8E867B]">
                Attività Operativa · {formatMonthYear()}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-[#F8F6F2] p-3.5">
                  <p className="text-xs text-[#625B52]">Ore Validate</p>
                  <p className="mt-1 font-display text-3xl font-semibold text-[#4A6759] tabular-nums">
                    {formatHours(summary?.monthly_validated_hours || 0)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#F8F6F2] p-3.5">
                  <p className="text-xs text-[#625B52]">Appelli Chiusi</p>
                  <p className="mt-1 font-display text-3xl font-semibold text-[#23201D] tabular-nums">
                    {summary?.monthly_validated_lessons || 0}
                  </p>
                </div>
              </div>
            </section>

            {/* Web Push Notifications (Service Worker) */}
            <section className="rounded-2xl border border-[#E8E2D9] bg-white p-5 space-y-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-[#EDF2EE] p-2.5 text-[#4A6759]">
                    <BellRing className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[#23201D]">
                      Notifiche Push Automatiche
                    </h2>
                    <p className="mt-0.5 text-xs text-[#625B52] leading-relaxed">
                      Ricevi due avvisi automatici sul telefono: <strong>60 minuti prima</strong>{' '}
                      della lezione (sala e orario) e <strong>15 minuti dopo la fine</strong> per
                      ricordarti di confermare l&apos;appello.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={pushBusy}
                  onClick={handleTogglePush}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors ${
                    user.has_push_subscription
                      ? 'border border-[#DED6C8] bg-[#F8F6F2] text-[#23201D] hover:bg-[#EFEAE1]'
                      : 'bg-[#4A6759] text-white hover:bg-[#3A5347]'
                  }`}
                >
                  <Bell className="h-4 w-4" />
                  {user.has_push_subscription
                    ? 'Push Attive · Disattiva'
                    : 'Attiva Notifiche Push'}
                </button>

                <button
                  type="button"
                  disabled={pushBusy}
                  onClick={handleTestPush}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#C9DBD0] bg-[#EDF2EE] px-3.5 py-2.5 text-xs font-medium text-[#2F6649] hover:bg-[#DFECE3]"
                >
                  <Wifi className="h-3.5 w-3.5" />
                  Invia Notifica di Prova
                </button>
              </div>
            </section>

            {/* Sincronizzazione Google Calendar (.ics dinamico con VALARM -60m e +15m) */}
            <section className="rounded-2xl border border-[#E8E2D9] bg-white p-5 space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-[#F9EFEA] p-2.5 text-[#B86B52]">
                  <CalendarCheck2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#23201D]">
                    Sincronizzazione Google Calendar
                  </h2>
                  <p className="mt-0.5 text-xs text-[#625B52] leading-relaxed">
                    Collega il tuo feed personale unidirezionale <code>.ics</code>: tutti i tuoi
                    turni e le sale compaiono in automatico con promemoria nativi a{' '}
                    <strong>-60 min</strong> e <strong>+15 min dalla fine</strong>.
                  </p>
                </div>
              </div>

              {icsHttpsUrl && (
                <>
                  <div className="flex items-center gap-2 rounded-xl border border-[#EAE4DA] bg-[#F8F6F2] px-3 py-2">
                    <input
                      type="text"
                      readOnly
                      value={icsHttpsUrl}
                      className="flex-1 bg-transparent text-xs text-[#625B52] focus:outline-none truncate"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await copyTextToClipboard(icsHttpsUrl);
                        notify(
                          ok ? 'success' : 'info',
                          ok
                            ? 'URL feed calendario copiato negli appunti.'
                            : 'Seleziona il link nel campo per copiarlo.'
                        );
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-white border border-[#DED6C8] px-2.5 py-1 text-xs font-medium text-[#23201D] hover:bg-[#EFEAE1]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copia
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <a
                      href={googleCalSubscribeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3A5347]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Aggiungi a Google Calendar
                    </a>
                    <a
                      href={icsHttpsUrl}
                      download="turni-atelier-elan.ics"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3.5 py-2.5 text-xs font-medium text-[#23201D] hover:bg-[#F4F0E8]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Scarica file .ics
                    </a>
                    <button
                      type="button"
                      onClick={handleRegenerateCalendarToken}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs text-[#8E867B] hover:text-[#23201D]"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rigenera token
                    </button>
                  </div>
                </>
              )}
            </section>

            {/* Installazione PWA su Schermata Home */}
            {!isStandalonePwa() && (
              <section className="rounded-2xl border border-[#E8E2D9] bg-[#F3EFE7] p-5 space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="h-5 w-5 text-[#4A6759]" />
                  <h2 className="text-sm font-semibold text-[#23201D]">
                    Installa l&apos;App sulla Schermata Home
                  </h2>
                </div>
                <p className="text-xs text-[#625B52] leading-relaxed">
                  {isIosDevice()
                    ? 'Su iPhone/iPad (iOS 16.4+): tocca il pulsante Condividi di Safari e seleziona "Aggiungi alla schermata Home" per ricevere le notifiche push anche ad app chiusa.'
                    : 'Aggiungi Atelier Élan alla schermata Home per aprirla a tutto schermo come app nativa e ricevere le notifiche anche ad app chiusa.'}
                </p>
                {installPrompt && (
                  <button
                    type="button"
                    onClick={onTriggerInstall}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#23201D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3A3530]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Installa PWA Ora
                  </button>
                )}
              </section>
            )}
          </div>
        )}
      </main>

      {/* Bottom Tab Bar Mobile-First per Insegnanti */}
      <nav
        aria-label="Navigazione insegnante"
        className="fixed bottom-0 inset-x-0 z-30 border-t border-[#E8E2D9] bg-white/95 backdrop-blur-md safe-bottom"
      >
        <div className="max-w-3xl mx-auto grid grid-cols-3 px-2 pt-2">
          <button
            type="button"
            onClick={() => setTab('rollcall')}
            className={`relative flex flex-col items-center gap-1 py-1.5 text-xs font-medium transition-colors ${
              tab === 'rollcall' ? 'text-[#4A6759]' : 'text-[#8E867B]'
            }`}
          >
            <div className="relative">
              <CheckCircle2 className="h-5 w-5" />
              {unvalidatedList.length > 0 && (
                <span className="absolute -top-1 -right-2 h-4 min-w-4 rounded-full bg-[#B5443A] px-1 text-[10px] font-bold text-white flex items-center justify-center tabular-nums">
                  {unvalidatedList.length}
                </span>
              )}
            </div>
            <span>Appelli</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('calendar')}
            className={`flex flex-col items-center gap-1 py-1.5 text-xs font-medium transition-colors ${
              tab === 'calendar' ? 'text-[#4A6759]' : 'text-[#8E867B]'
            }`}
          >
            <Calendar className="h-5 w-5" />
            <span>Calendario Sale</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('notifications')}
            className={`flex flex-col items-center gap-1 py-1.5 text-xs font-medium transition-colors ${
              tab === 'notifications' ? 'text-[#4A6759]' : 'text-[#8E867B]'
            }`}
          >
            <Bell className="h-5 w-5" />
            <span>Notifiche</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
