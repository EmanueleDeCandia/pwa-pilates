import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Inbox,
  MapPin,
  Send,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { WhatsAppIcon } from '../../components/BrandMark';
import { apiFetch, copyTextToClipboard, launchWhatsApp } from '../../lib/api';
import {
  addUtcDays,
  buildStudentReminderMessage,
  buildTargetedBroadcastMessage,
  formatDateLong,
  formatDateShort,
  formatTime,
  formatTimeRange,
  toUtcDateString,
} from '../../lib/format';
import type {
  AdminBookingView,
  FreeSlotSuggestion,
  LessonSlot,
  PublicInquiry,
  StudioSettings,
} from '../../../shared/types';

interface AdminWhatsAppProps {
  onOpenPublicBoard: () => void;
  onInquiriesChanged?: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
  syncTick: number;
}

export function AdminWhatsApp({
  onOpenPublicBoard,
  onInquiriesChanged,
  notify,
  syncTick,
}: AdminWhatsAppProps) {
  const tomorrowStr = addUtcDays(toUtcDateString(new Date()), 1);
  const [targetDate, setTargetDate] = useState<string>(tomorrowStr);
  const [dayLessons, setDayLessons] = useState<LessonSlot[]>([]);
  const [bookingsBySlot, setBookingsBySlot] = useState<Record<string, AdminBookingView[]>>({});
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  // Richieste posto dalla Bacheca Pubblica (Zero-Login — SRS 4.1)
  const [inquiries, setInquiries] = useState<PublicInquiry[]>([]);
  const [busyInquiryId, setBusyInquiryId] = useState<string | null>(null);

  // Broadcast Corsi Mirati & Slot Liberi (SRS 4.2.4)
  const [targetedLessons, setTargetedLessons] = useState<LessonSlot[]>([]);
  const [freeSlots, setFreeSlots] = useState<FreeSlotSuggestion[]>([]);
  const [selectedTargetedIds, setSelectedTargetedIds] = useState<Set<string>>(new Set());
  const [selectedFreeIdx, setSelectedFreeIdx] = useState<Set<number>>(new Set());
  const [broadcastText, setBroadcastText] = useState('');
  const [studioName, setStudioName] = useState('Atelier Élan');

  const publicBoardUrl = `${window.location.origin}/bacheca`;

  const loadDayReminders = useCallback(async () => {
    try {
      const res = await apiFetch<{ lessons: LessonSlot[] }>(
        `/api/lessons?from=${targetDate}T00:00:00.000Z&to=${targetDate}T23:59:59.999Z`
      );
      setDayLessons(res.lessons);
      const entries = await Promise.all(
        res.lessons.map(async (sl) => {
          const b = await apiFetch<{ bookings: AdminBookingView[] }>(
            `/api/lessons/${sl.id}/bookings`
          );
          return [sl.id, b.bookings] as const;
        })
      );
      setBookingsBySlot(Object.fromEntries(entries));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore caricamento promemoria.');
    }
  }, [targetDate, notify]);

  const loadBroadcastSources = useCallback(async () => {
    const today = toUtcDateString(new Date());
    const nextWeek = addUtcDays(today, 7);
    try {
      const [tRes, fRes, sRes, inqRes] = await Promise.all([
        apiFetch<{ lessons: LessonSlot[] }>(
          `/api/lessons?from=${encodeURIComponent(new Date().toISOString())}&targeted=true`
        ),
        apiFetch<{ free_slots: FreeSlotSuggestion[] }>(
          `/api/lessons/free-slots?startDate=${today}&endDate=${nextWeek}&windowStart=14:00&windowEnd=18:00&minDuration=60&weekdays=1,2,3,4,5`
        ),
        apiFetch<{ settings: StudioSettings }>('/api/settings'),
        apiFetch<{ inquiries: PublicInquiry[] }>('/api/inquiries'),
      ]);
      setTargetedLessons(tRes.lessons);
      setFreeSlots(fRes.free_slots.slice(0, 6));
      setStudioName(sRes.settings.studio_name);
      setInquiries(inqRes.inquiries);
      setSelectedTargetedIds(new Set(tRes.lessons.slice(0, 3).map((l) => l.id)));
      setSelectedFreeIdx(new Set(fRes.free_slots.length > 0 ? [0] : []));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore caricamento dati WhatsApp.');
    }
  }, [notify]);

  useEffect(() => {
    loadDayReminders();
  }, [loadDayReminders]);

  useEffect(() => {
    loadBroadcastSources();
  }, [loadBroadcastSources]);

  useEffect(() => {
    if (syncTick > 0) {
      loadDayReminders();
      loadBroadcastSources();
    }
  }, [syncTick]);

  // Rigenera testo broadcast al variare della selezione
  useEffect(() => {
    const chosenCourses = targetedLessons.filter((l) => selectedTargetedIds.has(l.id));
    const chosenFree = freeSlots.filter((_, i) => selectedFreeIdx.has(i));
    setBroadcastText(
      buildTargetedBroadcastMessage({
        studioName,
        targetedCourses: chosenCourses,
        freeSlots: chosenFree,
        publicBoardUrl,
      })
    );
  }, [targetedLessons, freeSlots, selectedTargetedIds, selectedFreeIdx, studioName, publicBoardUrl]);

  const toggleTargeted = (id: string) => {
    setSelectedTargetedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFree = (idx: number) => {
    setSelectedFreeIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleInquiryAction = async (inq: PublicInquiry, enroll: boolean) => {
    setBusyInquiryId(inq.id);
    try {
      const res = await apiFetch<{ ok: boolean; message?: string }>(`/api/inquiries/${inq.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'HANDLED', enroll }),
      });
      notify(
        'success',
        res.message || `Richiesta di ${inq.first_name} ${inq.last_name} contrassegnata come gestita.`
      );
      await Promise.all([loadBroadcastSources(), loadDayReminders()]);
      onInquiriesChanged?.();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore gestione richiesta.');
    } finally {
      setBusyInquiryId(null);
    }
  };

  const handleCopy = async (text: string, okMsg: string) => {
    const ok = await copyTextToClipboard(text);
    notify(ok ? 'success' : 'info', ok ? okMsg : 'Seleziona il testo per copiarlo manualmente.');
  };

  const isTomorrow = targetDate === tomorrowStr;
  const openInquiries = inquiries.filter((i) => i.status === 'NEW');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#8E867B]">
            Comunicazioni Dirette Zero-Cost (wa.me)
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#23201D] mt-0.5">
            Promemoria &amp; Broadcast WhatsApp
          </h1>
          <p className="mt-1 text-xs text-[#625B52]">
            Nessuna API a pagamento: genera link diretti con testo precompilato pronti da inviare
            dal telefono o WhatsApp Web.
          </p>
        </div>

        {/* Condivisione Bacheca Pubblica */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              handleCopy(publicBoardUrl, 'Link Bacheca Pubblica copiato negli appunti.')
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3.5 py-2 text-xs font-medium text-[#23201D] hover:bg-[#F4F0E8]"
          >
            <Copy className="h-3.5 w-3.5 text-[#4A6759]" />
            Copia Link Bacheca
          </button>
          <button
            type="button"
            onClick={onOpenPublicBoard}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3A5347]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Apri Bacheca
          </button>
        </div>
      </div>

      {/* RICHIESTE POSTO DALLA BACHECA PUBBLICA (Zero-Login — SRS 4.1) */}
      {inquiries.length > 0 && (
        <section className="rounded-2xl border border-[#E6C7BA] bg-[#FDF9F7] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#23201D] flex items-center gap-2">
                <Inbox className="h-5 w-5 text-[#B86B52]" />
                Richieste Posto dalla Bacheca Pubblica
              </h2>
              <p className="text-xs text-[#625B52]">
                Iscrivi direttamente l&apos;allievo al corso mirato oppure rispondi su WhatsApp in
                1 clic.
              </p>
            </div>
            {openInquiries.length > 0 && (
              <span className="rounded-full bg-[#B86B52] px-3 py-1 text-xs font-semibold text-white tabular-nums">
                {openInquiries.length} {openInquiries.length === 1 ? 'nuova' : 'nuove'}
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            {inquiries.slice(0, 8).map((inq) => {
              const confirmMsg = inq.lesson_title
                ? `Ciao ${inq.first_name}! Abbiamo ricevuto la tua richiesta per "${inq.lesson_title}"${
                    inq.lesson_start_time
                      ? ` di ${formatDateLong(inq.lesson_start_time)} alle ${formatTime(inq.lesson_start_time)}`
                      : ''
                  }${inq.room_name ? ` (${inq.room_name})` : ''}. Ti confermiamo con piacere il posto presso ${studioName}!`
                : `Ciao ${inq.first_name}! Grazie per aver contattato ${studioName}. Ti scriviamo per gli orari disponibili dei nostri corsi di Pilates.`;

              return (
                <div
                  key={inq.id}
                  className={`rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 ${
                    inq.status === 'NEW'
                      ? 'border-[#E6C7BA] bg-white'
                      : 'border-[#EAE4DA] bg-[#F8F6F2] opacity-75'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#23201D]">
                        {inq.first_name} {inq.last_name}
                      </span>
                      <span className="text-xs text-[#625B52] tabular-nums">{inq.phone}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          inq.status === 'NEW'
                            ? 'bg-[#F9EFEA] text-[#9A4B34]'
                            : 'bg-[#EAF4EE] text-[#2F6649]'
                        }`}
                      >
                        {inq.status === 'NEW' ? 'Da gestire' : 'Gestita'}
                      </span>
                    </div>
                    <p className="text-xs text-[#625B52]">
                      {inq.lesson_title ? (
                        <>
                          Corso: <strong className="text-[#23201D]">{inq.lesson_title}</strong>
                          {inq.lesson_start_time && (
                            <>
                              {' '}
                              · {formatDateShort(inq.lesson_start_time)}{' '}
                              {formatTime(inq.lesson_start_time)}
                            </>
                          )}
                          {inq.room_name && <> · {inq.room_name}</>}
                        </>
                      ) : (
                        'Richiesta informazioni generale'
                      )}
                      {inq.notes && <> — Nota: &ldquo;{inq.notes}&rdquo;</>}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {inq.status === 'NEW' && inq.lesson_slot_id && (
                      <button
                        type="button"
                        disabled={busyInquiryId === inq.id}
                        onClick={() => handleInquiryAction(inq, true)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Iscrivi al Corso
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        launchWhatsApp({
                          phone: inq.phone,
                          recipientName: `${inq.first_name} ${inq.last_name}`,
                          contextLabel: 'Risposta a richiesta dalla Bacheca Pubblica',
                          message: confirmMsg,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#C9DBD0] bg-[#EDF2EE] px-3 py-2 text-xs font-semibold text-[#2F6649] hover:bg-[#DFECE3]"
                    >
                      <WhatsAppIcon className="h-3.5 w-3.5" />
                      Rispondi WA
                    </button>
                    {inq.status === 'NEW' && (
                      <button
                        type="button"
                        disabled={busyInquiryId === inq.id}
                        onClick={() => handleInquiryAction(inq, false)}
                        className="rounded-xl border border-[#DED6C8] bg-white px-2.5 py-2 text-xs text-[#625B52] hover:text-[#23201D]"
                      >
                        Archivia
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SEZIONE 1: PROMEMORIA STUDENTI LEZIONI DEL GIORNO SUCCESSIVO (1-Click — SRS 4.2.1) */}
      <section className="rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#23201D]">
              Promemoria Lezione Studenti (1-Click)
            </h2>
            <p className="text-xs text-[#8E867B]">
              {isTomorrow ? 'Domani · ' : ''}
              {formatDateLong(targetDate)} — clicca &ldquo;Invia Promemoria&rdquo; accanto a ogni
              studente
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTargetDate(tomorrowStr)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium ${
                isTomorrow
                  ? 'bg-[#4A6759] text-white'
                  : 'bg-[#F4F0E8] text-[#625B52] hover:text-[#23201D]'
              }`}
            >
              Domani
            </button>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-1.5 text-xs"
            />
          </div>
        </div>

        {dayLessons.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#DED6C8] py-10 text-center text-sm text-[#8E867B]">
            Nessuna lezione in programma per {formatDateLong(targetDate)}.
          </div>
        ) : (
          <div className="space-y-4">
            {dayLessons.map((lesson) => {
              const list = (bookingsBySlot[lesson.id] || []).filter(
                (b) =>
                  b.attendance_status !== 'ABSENT_FROZEN' &&
                  b.attendance_status !== 'RESCHEDULE_REQUESTED'
              );

              return (
                <div
                  key={lesson.id}
                  className="rounded-2xl border border-[#EAE4DA] bg-[#FCFBF9] overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-[#EFEAE1] bg-[#F6F2EA] flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#23201D] tabular-nums">
                        <Clock className="h-3.5 w-3.5 text-[#4A6759]" />
                        {formatTimeRange(lesson.start_time, lesson.end_time)}
                      </span>
                      <span className="font-semibold text-[#23201D]">{lesson.title}</span>
                      <span className="inline-flex items-center gap-1 text-[#625B52]">
                        <MapPin className="h-3 w-3 text-[#4A6759]" />
                        {lesson.room_name}
                      </span>
                      <span className="text-[#8E867B]">· Docente: {lesson.teacher_name}</span>
                    </div>
                    <span className="text-xs font-medium text-[#625B52] tabular-nums">
                      {list.length} {list.length === 1 ? 'iscritto' : 'iscritti'}
                    </span>
                  </div>

                  {list.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-[#8E867B]">
                      Nessun allievo attivo assegnato a questo slot.
                    </p>
                  ) : (
                    <div className="divide-y divide-[#EFEAE1]">
                      {list.map((b) => {
                        const msg = buildStudentReminderMessage({
                          firstName: b.student_first_name,
                          courseTitle: lesson.title,
                          startTimeIso: lesson.start_time,
                          roomName: lesson.room_name,
                        });
                        const wasSent = sentIds.has(b.id);

                        return (
                          <div
                            key={b.id}
                            className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-[#23201D]">
                                {b.student_first_name} {b.student_last_name}{' '}
                                <span className="text-xs font-normal text-[#8E867B] tabular-nums">
                                  ({b.student_phone})
                                </span>
                              </p>
                              <p className="mt-0.5 text-xs text-[#625B52] line-clamp-1">{msg}</p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopy(msg, 'Messaggio copiato negli appunti.')
                                }
                                title="Copia testo messaggio"
                                className="rounded-lg border border-[#DED6C8] bg-white p-2 text-[#625B52] hover:text-[#23201D]"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  launchWhatsApp({
                                    phone: b.student_phone,
                                    recipientName: `${b.student_first_name} ${b.student_last_name}`,
                                    contextLabel: `Promemoria · ${lesson.title} (${formatTimeRange(
                                      lesson.start_time,
                                      lesson.end_time
                                    )})`,
                                    message: msg,
                                    onMarkedSent: () =>
                                      setSentIds((prev) => new Set(prev).add(b.id)),
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                                  wasSent
                                    ? 'bg-[#EAF4EE] text-[#2F6649] border border-[#BDDAC8]'
                                    : 'bg-[#4A6759] text-white hover:bg-[#3A5347]'
                                }`}
                              >
                                {wasSent ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <WhatsAppIcon className="h-3.5 w-3.5" />
                                )}
                                {wasSent ? 'Inviato su WA' : 'Invia Promemoria'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SEZIONE 2: GENERATORE BROADCAST CORSI MIRATI & SLOT LIBERI (SRS 4.2.4) */}
      <section className="rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#23201D] flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#B86B52]" />
            Generatore Broadcast Corsi Mirati &amp; Slot Liberi
          </h2>
          <p className="text-xs text-[#8E867B]">
            Seleziona i corsi speciali e le fasce pomeridiane libere da includere nel messaggio
            promozionale per le liste broadcast WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#625B52]">
                Corsi Mirati Attivi ({targetedLessons.length})
              </h3>
              {targetedLessons.length === 0 ? (
                <p className="text-xs text-[#8E867B]">
                  Nessun corso mirato futuro in programma.
                </p>
              ) : (
                targetedLessons.map((c) => {
                  const rem = Math.max(0, c.max_capacity - c.active_bookings_count);
                  return (
                    <label
                      key={c.id}
                      className="flex items-start gap-2.5 rounded-xl border border-[#EAE4DA] bg-[#FCFBF9] p-3 text-xs cursor-pointer hover:border-[#4A6759]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTargetedIds.has(c.id)}
                        onChange={() => toggleTargeted(c.id)}
                        className="mt-0.5 h-4 w-4 accent-[#4A6759]"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-[#23201D]">{c.title}</p>
                        <p className="text-[#625B52] mt-0.5">
                          {formatDateShort(c.start_time)} · {formatTimeRange(c.start_time, c.end_time)}{' '}
                          · {c.room_name} ({rem} posti liberi)
                        </p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {freeSlots.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#625B52]">
                  Fasce Pomeridiane Libere (14:00–18:00)
                </h3>
                {freeSlots.map((fs, idx) => (
                  <label
                    key={`${fs.start_time}-${idx}`}
                    className="flex items-start gap-2.5 rounded-xl border border-[#EAE4DA] bg-[#FCFBF9] p-3 text-xs cursor-pointer hover:border-[#B86B52]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFreeIdx.has(idx)}
                      onChange={() => toggleFree(idx)}
                      className="mt-0.5 h-4 w-4 accent-[#B86B52]"
                    />
                    <div>
                      <p className="font-semibold text-[#23201D] capitalize">
                        {formatDateShort(fs.start_time)} · {formatTimeRange(fs.start_time, fs.end_time)}
                      </p>
                      <p className="text-[#625B52] mt-0.5">
                        Sale: {fs.available_rooms.map((r) => r.name).join(', ')}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-[#625B52]">
              Testo Precompilato (personalizzabile)
            </label>
            <textarea
              rows={11}
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              className="flex-1 w-full rounded-2xl border border-[#DED6C8] bg-[#FAF8F4] p-4 text-xs sm:text-sm text-[#23201D] leading-relaxed focus:border-[#4A6759] focus:bg-white focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    broadcastText,
                    'Messaggio Broadcast copiato! Pronto da incollare su WhatsApp.'
                  )
                }
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-[#4A6759] bg-white px-4 py-2.5 text-xs font-semibold text-[#4A6759] hover:bg-[#EDF2EE]"
              >
                <Copy className="h-4 w-4" />
                Copia per Lista Broadcast
              </button>
              <button
                type="button"
                onClick={() =>
                  launchWhatsApp({
                    recipientName: 'Lista Broadcast Allievi',
                    contextLabel: 'Broadcast Corsi Mirati & Nuove Fasce Orarie',
                    message: broadcastText,
                  })
                }
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#4A6759] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3A5347]"
              >
                <Send className="h-4 w-4" />
                Inoltra su WhatsApp
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
