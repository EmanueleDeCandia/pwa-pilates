import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Check,
  Clock,
  CreditCard,
  History,
  MapPin,
  RotateCcw,
  Snowflake,
  Sparkles,
  Users,
} from 'lucide-react';
import { TrafficLightBadge, WhatsAppIcon } from '../../components/BrandMark';
import { Modal } from '../../components/Modal';
import { apiFetch, launchWhatsApp } from '../../lib/api';
import {
  AUDIT_ACTION_LABELS,
  PAYMENT_META,
  buildPackageRenewalMessage,
  buildPaymentReminderMessage,
  buildTeacherValidationReminderMessage,
  buildWhatsAppUrl,
  formatCurrency,
  formatDateLong,
  formatDateShort,
  formatDateTimeCompact,
  formatHours,
  formatMonthYear,
  formatTimeRange,
  getWeekdayShort,
  toUtcDateString,
} from '../../lib/format';
import type { ActionQueueItem, AdminDashboardData, LessonSlot } from '../../../shared/types';

interface AdminDashboardProps {
  onSelectLesson: (lesson: LessonSlot) => void;
  onNavigate: (section: 'calendar' | 'students' | 'teachers' | 'whatsapp' | 'audit') => void;
  onOpenFreeSlotsFinder: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
  syncTick: number;
  onActionCountChange: (count: number) => void;
}

const MATRIX_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export function AdminDashboard({
  onSelectLesson,
  onNavigate,
  onOpenFreeSlotsFinder,
  notify,
  syncTick,
  onActionCountChange,
}: AdminDashboardProps) {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Modale riprogrammazione lezione (SRS 3.2.2 & 4.4.2)
  const [rescheduleTarget, setRescheduleTarget] = useState<ActionQueueItem | null>(null);
  const [futureSlots, setFutureSlots] = useState<LessonSlot[]>([]);
  const [chosenSlotId, setChosenSlotId] = useState('');
  const [showAllAnalytics, setShowAllAnalytics] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await apiFetch<AdminDashboardData>(`/api/dashboard/admin?period=${period}`);
      setData(res);
      onActionCountChange(
        res.absent_pending_queue.length + res.reschedule_queue.length + res.unvalidated_past_total
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore caricamento dashboard.');
    } finally {
      setLoading(false);
    }
  }, [period, notify, onActionCountChange]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (syncTick > 0) loadDashboard();
  }, [syncTick]);

  // Azione discrezionale Titolare 1-Click: Scala o Congela assenza (SRS 3.2.3)
  const handleAbsenceDecision = async (
    item: ActionQueueItem,
    decision: 'ABSENT_DEDUCTED' | 'ABSENT_FROZEN'
  ) => {
    setBusyId(item.booking_id);
    try {
      await apiFetch(`/api/bookings/${item.booking_id}/attendance`, {
        method: 'PATCH',
        body: JSON.stringify({ attendance_status: decision }),
      });
      notify(
        'success',
        decision === 'ABSENT_DEDUCTED'
          ? `Lezione scalata dal pacchetto di ${item.student_first_name} ${item.student_last_name}.`
          : `Lezione congelata per ${item.student_first_name} ${item.student_last_name} (credito disponibile per recupero).`
      );
      await loadDashboard();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile registrare la decisione.');
    } finally {
      setBusyId(null);
    }
  };

  const openRescheduleModal = async (item: ActionQueueItem) => {
    setRescheduleTarget(item);
    setChosenSlotId('');
    try {
      const res = await apiFetch<{ lessons: LessonSlot[] }>(
        `/api/lessons?from=${encodeURIComponent(new Date().toISOString())}`
      );
      const avail = res.lessons.filter(
        (l) => !l.is_validated && l.active_bookings_count < l.max_capacity
      );
      setFutureSlots(avail);
      if (avail[0]) setChosenSlotId(avail[0].id);
    } catch {
      notify('error', 'Errore caricamento lezioni future disponibili.');
    }
  };

  const confirmReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleTarget || !chosenSlotId) return;
    setBusyId(rescheduleTarget.booking_id);
    try {
      await apiFetch(`/api/bookings/${rescheduleTarget.booking_id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ target_lesson_slot_id: chosenSlotId }),
      });
      notify(
        'success',
        `Lezione di ${rescheduleTarget.student_first_name} riprogrammata con successo.`
      );
      setRescheduleTarget(null);
      await loadDashboard();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore riprogrammazione.');
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkPackagePaid = async (pkgId: string, studentName: string) => {
    setBusyId(pkgId);
    try {
      await apiFetch(`/api/packages/${pkgId}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: 'PAID' }),
      });
      notify('success', `Registrato saldo completo per ${studentName}.`);
      await loadDashboard();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore registrazione pagamento.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="py-20 text-center text-sm text-[#8E867B]">
        Caricamento cruscotto operativo...
      </div>
    );
  }

  if (!data) return null;

  const greenCount = data.today_lessons.filter((l) => l.traffic_light === 'GREEN').length;
  const redCount = data.today_lessons.filter((l) => l.traffic_light === 'RED').length;
  const actionTotal = data.absent_pending_queue.length + data.reschedule_queue.length;
  const freq = data.frequency_aggregate;
  const visibleAnalytics = showAllAnalytics
    ? data.package_analytics
    : data.package_analytics.slice(0, 6);

  return (
    <div className="space-y-8">
      {/* Intestazione editoriale */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#8E867B]">
            Panoramica Titolare · {formatDateLong(toUtcDateString(new Date()))}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#23201D] mt-0.5">
            Dashboard &amp; Monitoraggio Studio
          </h1>
        </div>
        <button
          type="button"
          onClick={onOpenFreeSlotsFinder}
          className="inline-flex items-center gap-2 rounded-xl bg-[#4A6759] px-4 py-2.5 text-xs sm:text-sm font-medium text-white hover:bg-[#3A5347] transition-colors shadow-xs"
        >
          <Sparkles className="h-4 w-4 text-[#E5C9B8]" />
          Trova Ore Libere &amp; Corsi Mirati
        </button>
      </div>

      {/* 4 KPI Sintetici in alto */}
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
        <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8E867B]">Lezioni di Oggi</p>
          <p className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-[#23201D] tabular-nums">
            {data.today_lessons.length}
          </p>
          <p className="mt-1.5 text-xs tabular-nums flex flex-wrap items-center gap-2">
            <span className="text-[#2F6649] font-medium">{greenCount} validate</span>
            {redCount > 0 && (
              <span className="text-[#A63A31] font-semibold">· {redCount} scadute</span>
            )}
          </p>
        </div>

        <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8E867B]">Azioni Richieste</p>
          <p
            className={`mt-2 font-display text-3xl sm:text-4xl font-semibold tabular-nums ${
              actionTotal > 0 ? 'text-[#B86B52]' : 'text-[#2F6649]'
            }`}
          >
            {actionTotal}
          </p>
          <p className="mt-1.5 text-xs text-[#625B52] tabular-nums">
            {data.absent_pending_queue.length} assenze · {data.reschedule_queue.length} spostamenti
          </p>
        </div>

        <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8E867B]">Saldi da Incassare</p>
          <p
            className={`mt-2 font-display text-3xl sm:text-4xl font-semibold tabular-nums ${
              data.total_outstanding_amount > 0 ? 'text-[#A63A31]' : 'text-[#2F6649]'
            }`}
          >
            {formatCurrency(data.total_outstanding_amount)}
          </p>
          <p className="mt-1.5 text-xs text-[#625B52] tabular-nums">
            su {formatCurrency(data.total_sales_amount)} venduti ({data.unpaid_packages.length} in
            sospeso)
          </p>
        </div>

        <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 sm:p-5">
          <p className="text-xs font-medium text-[#8E867B]">Tasso Frequenza</p>
          <p className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-[#4A6759] tabular-nums">
            {freq.attendance_rate_pct}%
          </p>
          <p className="mt-1.5 text-xs text-[#625B52] tabular-nums">
            {freq.total_present} presenze · {freq.total_absences} assenze
          </p>
        </div>
      </section>

      {/* RIGA 1: (4.4.1) Stato Operativo Giornaliero Semaforico + (4.4.2) Coda Azioni Richieste */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* 4.4.1 Stato Operativo Giornaliero */}
        <div className="xl:col-span-7 rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                Stato Operativo Giornaliero
              </h2>
              <p className="text-xs text-[#8E867B]">
                Semaforo appelli in tempo reale · clicca su un corso per gestire iscritti o
                sbloccare l&apos;appello
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="text-xs font-medium text-[#4A6759] hover:underline inline-flex items-center gap-1 shrink-0"
            >
              Calendario
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {data.today_lessons.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#8E867B]">
              Nessuna lezione programmata per oggi.
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.today_lessons.map((slot) => {
                const sollecitoUrl =
                  slot.traffic_light === 'RED' && slot.teacher_phone
                    ? buildWhatsAppUrl(
                        slot.teacher_phone,
                        buildTeacherValidationReminderMessage(slot.teacher_name, [slot])
                      )
                    : null;

                return (
                  <div
                    key={slot.id}
                    onClick={() => onSelectLesson(slot)}
                    className={`group rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-all ${
                      slot.traffic_light === 'RED'
                        ? 'border-[#EBC3C0] bg-[#FEF8F7] hover:border-[#D99B96]'
                        : 'border-[#EAE4DA] bg-[#FCFBF9] hover:border-[#4A6759] hover:bg-white'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-[#23201D] tabular-nums">
                          {formatTimeRange(slot.start_time, slot.end_time)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#625B52]">
                          <MapPin className="h-3 w-3 text-[#4A6759]" />
                          {slot.room_name}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[#625B52]">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: slot.teacher_color }}
                          />
                          {slot.teacher_name}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[#23201D] group-hover:text-[#4A6759] transition-colors">
                        {slot.title}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 ml-auto">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-white border border-[#E6DFD3] px-2.5 py-1 text-xs font-semibold text-[#23201D] tabular-nums">
                        <Users className="h-3.5 w-3.5 text-[#8E867B]" />
                        {slot.active_bookings_count}/{slot.max_capacity}
                      </span>

                      <TrafficLightBadge status={slot.traffic_light} />

                      {sollecitoUrl && slot.teacher_phone && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            launchWhatsApp({
                              phone: slot.teacher_phone,
                              recipientName: slot.teacher_name,
                              contextLabel: `Sollecito validazione appello · ${slot.title}`,
                              message: buildTeacherValidationReminderMessage(slot.teacher_name, [
                                slot,
                              ]),
                            });
                          }}
                          title={`Sollecita ${slot.teacher_name} su WhatsApp`}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#B5443A] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#99352C] transition-colors"
                        >
                          <WhatsAppIcon className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Sollecita</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4.4.2 Coda Azioni Richieste: Assenze da Decidere + Richieste di Spostamento */}
        <div className="xl:col-span-5 rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#23201D]">
              Coda Azioni Richieste
            </h2>
            <p className="text-xs text-[#8E867B]">
              Decidi con un clic se scalare o congelare le assenze e riprogramma i recuperi
            </p>
          </div>

          {/* Assenze in attesa di decisione */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#9A651C] flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              Assenze da Decidere ({data.absent_pending_queue.length})
            </h3>
            {data.absent_pending_queue.length === 0 ? (
              <p className="rounded-xl bg-[#F8F6F2] px-3.5 py-3 text-xs text-[#8E867B]">
                Nessuna assenza in attesa di decisione.
              </p>
            ) : (
              data.absent_pending_queue.map((item) => (
                <div
                  key={item.booking_id}
                  className="rounded-xl border border-[#ECD4AA] bg-[#FDFAF3] p-3.5 flex flex-wrap items-center justify-between gap-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#23201D]">
                      {item.student_first_name} {item.student_last_name}
                    </p>
                    <p className="text-xs text-[#625B52]">
                      {item.lesson_title} · {formatDateTimeCompact(item.lesson_start_time)}
                    </p>
                    <p className="text-[11px] text-[#8E867B] tabular-nums">
                      {item.package_name} ({item.package_remaining_credits} crediti attuali)
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === item.booking_id}
                      onClick={() => handleAbsenceDecision(item, 'ABSENT_DEDUCTED')}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#B86B52] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#9E5740] transition-colors disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Scala
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.booking_id}
                      onClick={() => handleAbsenceDecision(item, 'ABSENT_FROZEN')}
                      className="inline-flex items-center gap-1 rounded-lg border border-[#B9CEDB] bg-[#EBF1F5] px-3 py-1.5 text-xs font-semibold text-[#365469] hover:bg-[#DCE7EE] transition-colors disabled:opacity-50"
                    >
                      <Snowflake className="h-3.5 w-3.5" />
                      Congela
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Richieste di spostamento */}
          <div className="space-y-2.5 pt-2 border-t border-[#F1ECE3]">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#5A5070] flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Spostamenti da Riprogrammare ({data.reschedule_queue.length})
            </h3>
            {data.reschedule_queue.length === 0 ? (
              <p className="rounded-xl bg-[#F8F6F2] px-3.5 py-3 text-xs text-[#8E867B]">
                Nessuna richiesta di spostamento pendente.
              </p>
            ) : (
              data.reschedule_queue.map((item) => (
                <div
                  key={item.booking_id}
                  className="rounded-xl border border-[#D4CEE2] bg-[#FAF9FC] p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#23201D]">
                        {item.student_first_name} {item.student_last_name}
                      </p>
                      <p className="text-xs text-[#625B52]">
                        Da: {item.lesson_title} ({formatDateShort(item.lesson_start_time)})
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openRescheduleModal(item)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#4A6759] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3A5347]"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      Riprogramma
                    </button>
                  </div>
                  {item.reschedule_note && (
                    <p className="text-xs text-[#5A5070] italic bg-white/80 rounded-lg px-2.5 py-1.5 border border-[#E6E2F0]">
                      &ldquo;{item.reschedule_note}&rdquo; — {item.teacher_name.split(' ')[0]}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* RIGA 2: (4.4.3) KPI Finanziari (Pagamenti in sospeso) + Alert Rinnovo Pacchetti */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pagamenti in Sospeso */}
        <div className="rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                Pagamenti in Sospeso
              </h2>
              <p className="text-xs text-[#8E867B] tabular-nums">
                Incassati {formatCurrency(data.total_collected_amount)} · Residuo{' '}
                <strong className="text-[#A63A31]">
                  {formatCurrency(data.total_outstanding_amount)}
                </strong>
              </p>
            </div>
            <CreditCard className="h-5 w-5 text-[#B86B52]" />
          </div>

          {data.unpaid_packages.length === 0 ? (
            <p className="rounded-xl bg-[#EAF4EE] px-4 py-4 text-xs text-[#2F6649]">
              Tutti i pacchetti risultano regolarmente saldati.
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.unpaid_packages.map((p) => {
                const pm = PAYMENT_META[p.payment_status];
                const wa = p.student_phone
                  ? buildWhatsAppUrl(
                      p.student_phone,
                      buildPaymentReminderMessage(
                        p.student_first_name || '',
                        p.name,
                        p.balance_due
                      )
                    )
                  : '#';

                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-[#EAE4DA] bg-[#FCFBF9] p-3.5 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#23201D]">
                          {p.student_first_name} {p.student_last_name}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pm.bg} ${pm.text} ${pm.border}`}
                        >
                          {pm.label}
                        </span>
                      </div>
                      <p className="text-xs text-[#625B52] mt-0.5 tabular-nums">
                        {p.name} · Versati {formatCurrency(p.amount_paid)} su{' '}
                        {formatCurrency(p.price)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-sm font-bold text-[#A63A31] tabular-nums">
                        {formatCurrency(p.balance_due)}
                      </span>
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() =>
                          handleMarkPackagePaid(
                            p.id,
                            `${p.student_first_name} ${p.student_last_name}`
                          )
                        }
                        className="rounded-lg bg-[#4A6759] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#3A5347]"
                      >
                        Salda
                      </button>
                      {p.student_phone && (
                        <button
                          type="button"
                          onClick={() =>
                            launchWhatsApp({
                              phone: p.student_phone,
                              recipientName: `${p.student_first_name || ''} ${
                                p.student_last_name || ''
                              }`.trim(),
                              contextLabel: `Promemoria saldo · ${p.name}`,
                              message: buildPaymentReminderMessage(
                                p.student_first_name || '',
                                p.name,
                                p.balance_due
                              ),
                            })
                          }
                          title="Invia promemoria saldo WhatsApp"
                          className="rounded-lg border border-[#DED6C8] bg-white p-1.5 text-[#4A6759] hover:bg-[#EDF2EE]"
                        >
                          <WhatsAppIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Alert Rinnovo Pacchetti (Crediti residui <= soglia) */}
        <div className="rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                Alert Rinnovo Pacchetti
              </h2>
              <p className="text-xs text-[#8E867B]">
                Studenti con ≤ 2 lezioni residue o pacchetto esaurito/scaduto
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('students')}
              className="text-xs font-medium text-[#4A6759] hover:underline inline-flex items-center gap-1"
            >
              Gestisci
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {data.low_credit_packages.length === 0 ? (
            <p className="rounded-xl bg-[#F8F6F2] px-4 py-4 text-xs text-[#8E867B]">
              Nessun pacchetto in esaurimento al momento.
            </p>
          ) : (
            <div className="space-y-2.5">
              {data.low_credit_packages.map((p) => {
                const wa = p.student_phone
                  ? buildWhatsAppUrl(
                      p.student_phone,
                      buildPackageRenewalMessage(
                        p.student_first_name || '',
                        p.name,
                        p.remaining_credits
                      )
                    )
                  : '#';
                return (
                  <div
                    key={p.id}
                    className="rounded-xl border border-[#EAE4DA] bg-[#FCFBF9] p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#23201D]">
                        {p.student_first_name} {p.student_last_name}
                      </p>
                      <p className="text-xs text-[#625B52] truncate">{p.name}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
                          p.remaining_credits === 0
                            ? 'bg-[#FBECEB] text-[#A63A31]'
                            : 'bg-[#FCF4E6] text-[#9A651C]'
                        }`}
                      >
                        {p.remaining_credits === 0
                          ? 'Esaurito (0/' + p.total_credits + ')'
                          : `${p.remaining_credits} ${
                              p.remaining_credits === 1 ? 'residua' : 'residue'
                            } su ${p.total_credits}`}
                      </span>
                      {p.student_phone && (
                        <button
                          type="button"
                          onClick={() =>
                            launchWhatsApp({
                              phone: p.student_phone,
                              recipientName: `${p.student_first_name || ''} ${
                                p.student_last_name || ''
                              }`.trim(),
                              contextLabel: `Proposta rinnovo · ${p.name}`,
                              message: buildPackageRenewalMessage(
                                p.student_first_name || '',
                                p.name,
                                p.remaining_credits
                              ),
                            })
                          }
                          title="Proponi rinnovo su WhatsApp"
                          className="inline-flex items-center gap-1 rounded-lg border border-[#C9DBD0] bg-[#EDF2EE] px-2.5 py-1.5 text-xs font-medium text-[#2F6649] hover:bg-[#DFECE3]"
                        >
                          <WhatsAppIcon className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Rinnovo</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* RIGA 3: (4.4.4) Analitica Frequenza Pacchetti (Aggregato + Dettaglio Studente) */}
      <section className="rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#23201D]">
              Analitica Frequenza Pacchetti
            </h2>
            <p className="text-xs text-[#8E867B]">
              Rapporto automatico tra lezioni vendute, presenze effettive e assenze (scalate o
              congelate)
            </p>
          </div>

          {/* Riepilogo aggregato conforme SRS 4.4.4 */}
          <div className="rounded-xl bg-[#F4F0E8] border border-[#E5DEC9] px-4 py-2 text-xs sm:text-sm font-medium text-[#23201D] tabular-nums">
            <strong>{freq.total_credits_sold}</strong> lezioni vendute{' '}
            <span className="text-[#BFB3A2] mx-1">|</span>
            <strong className="text-[#2F6649]">{freq.total_present}</strong> presenze{' '}
            <span className="text-[#BFB3A2] mx-1">|</span>
            <strong className="text-[#B86B52]">{freq.total_absences}</strong> assenze{' '}
            <span className="text-xs text-[#625B52]">
              ({freq.total_absent_deducted} scalate, {freq.total_absent_frozen} congelate
              {freq.total_absent_pending > 0 ? `, ${freq.total_absent_pending} in attesa` : ''})
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visibleAnalytics.map((p) => {
            const pPct = Math.round((p.present_count / p.total_credits) * 100);
            const dPct = Math.round((p.absent_deducted_count / p.total_credits) * 100);
            const fPct = Math.min(
              100 - pPct - dPct,
              Math.round((p.absent_frozen_count / p.total_credits) * 100)
            );
            return (
              <div
                key={p.id}
                className="rounded-xl border border-[#EAE4DA] bg-[#FCFBF9] p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#23201D]">
                    {p.student_first_name} {p.student_last_name}
                  </span>
                  <span className="text-[11px] text-[#8E867B] truncate">{p.name}</span>
                </div>
                <p className="text-xs text-[#625B52] tabular-nums">
                  <strong className="text-[#23201D]">{p.total_credits} lezioni</strong> |{' '}
                  <span className="text-[#2F6649] font-medium">{p.present_count} presenze</span> |{' '}
                  <span className="text-[#9A533D] font-medium">{p.total_absences} assenze</span>
                  {p.total_absences > 0 && (
                    <span className="text-[#8E867B]">
                      {' '}
                      ({p.absent_deducted_count} scalat{p.absent_deducted_count === 1 ? 'a' : 'e'},{' '}
                      {p.absent_frozen_count} congelat{p.absent_frozen_count === 1 ? 'a' : 'e'})
                    </span>
                  )}{' '}
                  · <strong>{p.remaining_credits} residue</strong>
                </p>
                <div className="h-2 w-full rounded-full bg-[#EAE4DA] overflow-hidden flex">
                  <div
                    className="h-full bg-[#4A6759]"
                    style={{ width: `${pPct}%` }}
                    title={`${p.present_count} presenze`}
                  />
                  <div
                    className="h-full bg-[#B86B52]"
                    style={{ width: `${dPct}%` }}
                    title={`${p.absent_deducted_count} assenze scalate`}
                  />
                  <div
                    className="h-full bg-[#7A9BB0]"
                    style={{ width: `${fPct}%` }}
                    title={`${p.absent_frozen_count} assenze congelate`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {data.package_analytics.length > 6 && (
          <button
            type="button"
            onClick={() => setShowAllAnalytics((v) => !v)}
            className="text-xs font-medium text-[#4A6759] hover:underline"
          >
            {showAllAnalytics
              ? 'Mostra riepilogo compatto'
              : `Mostra tutti i ${data.package_analytics.length} pacchetti`}
          </button>
        )}
      </section>

      {/* RIGA 4: (4.4.5) Utilizzo Sale, Matrice Giorni/Ore & Monte Ore Insegnanti */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Occupazione Sale + Matrice Giorni/Ore */}
        <div className="xl:col-span-8 rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                Occupazione Sale &amp; Fasce Orarie
              </h2>
              <p className="text-xs text-[#8E867B]">
                Le celle chiare evidenziano i pomeriggi scarichi ideali per nuovi corsi mirati
              </p>
            </div>
            <div className="inline-flex rounded-xl bg-[#EFEAE1] p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setPeriod('week')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  period === 'week' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
                }`}
              >
                Settimana
              </button>
              <button
                type="button"
                onClick={() => setPeriod('month')}
                className={`rounded-lg px-3 py-1.5 transition-all ${
                  period === 'month' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
                }`}
              >
                Mese
              </button>
            </div>
          </div>

          {/* Card percentuale per Sala */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {data.room_occupancy.map((rm) => (
              <div
                key={rm.room_id}
                className="rounded-xl border border-[#EAE4DA] bg-[#F8F6F2] p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[#23201D]">{rm.room_name}</span>
                  <span className="text-xs font-bold text-[#4A6759] tabular-nums">
                    {rm.seat_occupancy_pct}% posti
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#E5DEC9] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#4A6759]"
                    style={{ width: `${rm.seat_occupancy_pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-[#625B52] tabular-nums flex justify-between">
                  <span>
                    {rm.lessons_count} corsi · {formatHours(rm.hours_used)} attive (
                    {rm.time_utilization_pct}% orario)
                  </span>
                  <span>
                    {rm.total_seats_booked}/{rm.total_seats_offered} posti
                  </span>
                </p>
              </div>
            ))}
          </div>

          {/* Matrice Giorni × Ore (Lun-Sab, 08:00-20:00) */}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-[11px]">
              <thead>
                <tr>
                  <th className="text-left font-medium text-[#8E867B] pr-2 py-1">Giorno</th>
                  {MATRIX_HOURS.map((h) => (
                    <th key={h} className="font-medium text-[#8E867B] tabular-nums text-center">
                      {String(h).padStart(2, '0')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((dow) => (
                  <tr key={dow}>
                    <td className="font-semibold text-[#625B52] pr-2 py-0.5">
                      {getWeekdayShort(dow)}
                    </td>
                    {MATRIX_HOURS.map((h) => {
                      const cell = data.occupancy_matrix.find(
                        (c) => c.day_of_week === dow && c.hour === h
                      );
                      const slots = cell?.slots_count || 0;
                      const pct = cell?.seat_occupancy_pct || 0;
                      const isAfternoonFree = slots === 0 && h >= 14 && h <= 17 && dow <= 5;
                      const bg =
                        slots === 0
                          ? isAfternoonFree
                            ? 'bg-[#FAF3E8] border border-dashed border-[#E2CBB0] text-[#B8895A]'
                            : 'bg-[#F5F2EC] text-transparent'
                          : pct >= 70
                            ? 'bg-[#4A6759] text-white'
                            : pct >= 40
                              ? 'bg-[#84A393] text-white'
                              : 'bg-[#CAD9D0] text-[#2F4A3D]';
                      return (
                        <td key={h} className="p-0">
                          <div
                            title={
                              slots === 0
                                ? `${getWeekdayShort(dow)} ${h}:00 — Libero (tutte le sale disponibili)`
                                : `${getWeekdayShort(dow)} ${h}:00 — ${slots} corso/i · ${cell?.booked_seats}/${cell?.total_capacity} posti (${pct}%)`
                            }
                            className={`h-7 min-w-6 rounded-md flex items-center justify-center tabular-nums font-medium ${bg}`}
                          >
                            {slots > 0 ? `${pct}%` : isAfternoonFree ? '·' : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8E867B]">
              <span>
                Tratteggiato = fascia pomeridiana 14:00–18:00 completamente libera per corsi mirati
              </span>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#FAF3E8] border border-dashed border-[#D8BC9C]" />
                  Libero
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#84A393]" />
                  Media
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#4A6759]" />
                  Alta
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Monte Ore Insegnanti + Audit Log Rapido */}
        <div className="xl:col-span-4 flex flex-col gap-6">
          <div className="rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                  Monte Ore Docenti
                </h2>
                <p className="text-xs text-[#8E867B]">
                  {formatMonthYear()} · solo ore validate (SRS 3.3)
                </p>
              </div>
              <Clock className="h-5 w-5 text-[#4A6759]" />
            </div>

            <div className="space-y-3">
              {data.teacher_hours.map((th) => {
                const ratio =
                  th.scheduled_hours_month > 0
                    ? Math.min(100, Math.round((th.validated_hours_month / th.scheduled_hours_month) * 100))
                    : 0;
                return (
                  <div
                    key={th.teacher_id}
                    className="rounded-xl border border-[#EAE4DA] bg-[#FCFBF9] p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#23201D]">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: th.color }}
                        />
                        {th.full_name}
                      </span>
                      <span className="text-base font-bold text-[#23201D] tabular-nums">
                        {formatHours(th.validated_hours_month)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#E8E2D9] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${ratio}%`, backgroundColor: th.color }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#625B52] tabular-nums">
                      <span>
                        {th.validated_lessons_month} validate su{' '}
                        {formatHours(th.scheduled_hours_month)} prog.
                      </span>
                      {th.unvalidated_past_lessons > 0 && (
                        <span className="text-[#A63A31] font-semibold">
                          {th.unvalidated_past_lessons} appelli aperti
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4.4.6 Ultimi Eventi Audit Log */}
          <div className="rounded-2xl border border-[#E8E2D9] bg-white p-5 sm:p-6 space-y-3.5 flex-1">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold text-[#23201D] flex items-center gap-2">
                <History className="h-4 w-4 text-[#4A6759]" />
                Audit Recente
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('audit')}
                className="text-xs font-medium text-[#4A6759] hover:underline"
              >
                Vedi tutto
              </button>
            </div>

            <div className="space-y-2">
              {data.recent_audit_logs.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between gap-2 border-b border-[#F3EFE7] pb-2 last:border-0 last:pb-0 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[#23201D] truncate">
                      {AUDIT_ACTION_LABELS[log.action_type] || log.action_type}
                      {log.metadata.lesson_title ? ` · ${String(log.metadata.lesson_title)}` : ''}
                    </p>
                    <p className="text-[11px] text-[#8E867B]">
                      {log.actor_name}
                      {log.metadata.student_name ? ` → ${String(log.metadata.student_name)}` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] text-[#8E867B] tabular-nums shrink-0">
                    {formatDateTimeCompact(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Modale Riprogrammazione Lezione */}
      <Modal
        open={Boolean(rescheduleTarget)}
        onClose={() => setRescheduleTarget(null)}
        title="Riprogramma Lezione"
        subtitle={
          rescheduleTarget
            ? `${rescheduleTarget.student_first_name} ${rescheduleTarget.student_last_name} · credito congelato da "${rescheduleTarget.lesson_title}"`
            : undefined
        }
      >
        {rescheduleTarget && (
          <form onSubmit={confirmReschedule} className="space-y-4">
            {rescheduleTarget.reschedule_note && (
              <div className="rounded-xl bg-[#F1EFF6] border border-[#D4CEE2] p-3 text-xs text-[#5A5070]">
                <strong>Nota docente:</strong> {rescheduleTarget.reschedule_note}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1.5">
                Seleziona la nuova lezione con posti disponibili
              </label>
              <select
                required
                value={chosenSlotId}
                onChange={(e) => setChosenSlotId(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              >
                {futureSlots.length === 0 && (
                  <option value="">Nessuna lezione futura con posti liberi</option>
                )}
                {futureSlots.map((sl) => (
                  <option key={sl.id} value={sl.id}>
                    {formatDateShort(sl.start_time)} {formatTimeRange(sl.start_time, sl.end_time)} —{' '}
                    {sl.title} ({sl.room_name} · {sl.active_bookings_count}/{sl.max_capacity})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="rounded-xl border border-[#DED6C8] px-4 py-2 text-sm text-[#625B52]"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={!chosenSlotId || busyId === rescheduleTarget.booking_id}
                className="rounded-xl bg-[#4A6759] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
              >
                Conferma Nuova Data
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
