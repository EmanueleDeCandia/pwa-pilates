import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Edit3,
  Mail,
  Phone,
  UserPlus,
} from 'lucide-react';
import { Modal } from '../../components/Modal';
import { WhatsAppIcon } from '../../components/BrandMark';
import { apiFetch, launchWhatsApp } from '../../lib/api';
import {
  addUtcDays,
  buildTeacherShiftsMessage,
  buildTeacherValidationReminderMessage,
  buildWhatsAppUrl,
  formatDateShort,
  formatHours,
  formatMonthYear,
  formatTimeRange,
  toUtcDateString,
} from '../../lib/format';
import type { LessonSlot, TeacherSummary } from '../../../shared/types';

interface AdminTeachersProps {
  teachers: TeacherSummary[];
  onMetaChanged: () => void;
  onSelectLesson: (lesson: LessonSlot) => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
  syncTick: number;
}

const PALETTE = ['#4A6759', '#B86B52', '#6E6582', '#4B6B82', '#9C7A47'];

export function AdminTeachers({
  teachers,
  onMetaChanged,
  onSelectLesson,
  notify,
  syncTick,
}: AdminTeachersProps) {
  const [unvalidatedSlots, setUnvalidatedSlots] = useState<LessonSlot[]>([]);
  const [upcomingSlots, setUpcomingSlots] = useState<LessonSlot[]>([]);
  const [modalTarget, setModalTarget] = useState<TeacherSummary | 'NEW' | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+39');
  const [color, setColor] = useState('#6E6582');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const loadTeacherSchedules = useCallback(async () => {
    const today = toUtcDateString(new Date());
    const tmr = addUtcDays(today, 1);
    const weekOut = addUtcDays(today, 7);
    try {
      const [unvalRes, upRes] = await Promise.all([
        apiFetch<{ lessons: LessonSlot[] }>('/api/lessons?unvalidatedPast=true'),
        apiFetch<{ lessons: LessonSlot[] }>(
          `/api/lessons?from=${tmr}T00:00:00.000Z&to=${weekOut}T23:59:59.999Z`
        ),
      ]);
      setUnvalidatedSlots(unvalRes.lessons);
      setUpcomingSlots(upRes.lessons);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadTeacherSchedules();
  }, [loadTeacherSchedules]);

  useEffect(() => {
    if (syncTick > 0) {
      loadTeacherSchedules();
      onMetaChanged();
    }
  }, [syncTick]);

  const openNew = () => {
    setFullName('');
    setEmail('');
    setPhone('+39');
    setColor(PALETTE[teachers.length % PALETTE.length]);
    setPassword('Staff2026!');
    setModalTarget('NEW');
  };

  const openEdit = (t: TeacherSummary) => {
    setFullName(t.full_name);
    setEmail(t.email || '');
    setPhone(t.phone || '+39');
    setColor(t.color);
    setPassword('');
    setModalTarget(t);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modalTarget === 'NEW') {
        await apiFetch('/api/teachers', {
          method: 'POST',
          body: JSON.stringify({ full_name: fullName, email, phone, color, password }),
        });
        notify('success', `Profilo insegnante ${fullName} creato.`);
      } else if (modalTarget) {
        await apiFetch(`/api/teachers/${modalTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: fullName,
            email,
            phone,
            color,
            ...(password ? { password } : {}),
          }),
        });
        notify('success', 'Profilo insegnante aggiornato.');
      }
      setModalTarget(null);
      onMetaChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore salvataggio insegnante.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#8E867B]">
            Staff, Monte Ore Operativo &amp; Verifica Appelli
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#23201D] mt-0.5">
            Profili Insegnanti
          </h1>
          <p className="mt-1 text-xs text-[#625B52]">
            Tracciamento statistico del monte ore validato nel mese di {formatMonthYear()} (nessun
            modulo compensi, come da specifica SRS 3.3).
          </p>
        </div>

        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3A5347] shadow-xs"
        >
          <UserPlus className="h-4 w-4" />
          Aggiungi Insegnante
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {teachers.map((t) => {
          const tUnvalidated = unvalidatedSlots.filter((l) => l.teacher_id === t.id);
          const tUpcoming = upcomingSlots.filter((l) => l.teacher_id === t.id).slice(0, 5);

          const waShiftsUrl = t.phone
            ? buildWhatsAppUrl(t.phone, buildTeacherShiftsMessage(t.full_name, tUpcoming))
            : '#';
          const waReminderUrl =
            t.phone && tUnvalidated.length > 0
              ? buildWhatsAppUrl(
                  t.phone,
                  buildTeacherValidationReminderMessage(t.full_name, tUnvalidated)
                )
              : null;

          return (
            <article
              key={t.id}
              className="rounded-2xl border border-[#E8E2D9] bg-white p-6 flex flex-col justify-between gap-5"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-11 w-11 rounded-2xl flex items-center justify-center text-white font-display text-xl font-semibold"
                      style={{ backgroundColor: t.color }}
                    >
                      {t.full_name
                        .split(' ')
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')}
                    </div>
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-[#23201D] leading-none">
                        {t.full_name}
                      </h2>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#625B52]">
                        {t.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3 text-[#8E867B]" />
                            {t.email}
                          </span>
                        )}
                        {t.phone && (
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Phone className="h-3 w-3 text-[#8E867B]" />
                            {t.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    className="rounded-lg border border-[#E2DACD] p-2 text-[#625B52] hover:bg-[#F4F0E8]"
                    title="Modifica profilo insegnante"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                </div>

                {/* Statistiche operative mensili */}
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="rounded-xl bg-[#F8F6F2] p-3">
                    <p className="text-[11px] text-[#8E867B] flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Ore validate
                    </p>
                    <p className="mt-1 text-xl font-bold text-[#23201D] tabular-nums">
                      {formatHours(t.monthly_validated_hours || 0)}
                    </p>
                    <p className="text-[10px] text-[#8E867B] tabular-nums">
                      su {formatHours(t.monthly_scheduled_hours || 0)} mese
                    </p>
                  </div>

                  <div className="rounded-xl bg-[#F8F6F2] p-3">
                    <p className="text-[11px] text-[#8E867B] flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Appelli chiusi
                    </p>
                    <p className="mt-1 text-xl font-bold text-[#2F6649] tabular-nums">
                      {t.monthly_validated_lessons || 0}
                    </p>
                    <p className="text-[10px] text-[#8E867B]">mese corrente</p>
                  </div>

                  <div className="rounded-xl bg-[#F8F6F2] p-3">
                    <p className="text-[11px] text-[#8E867B] flex items-center gap-1">
                      <Bell className="h-3 w-3" /> Web Push
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#23201D]">
                      {t.has_push_subscription ? 'Attive' : 'Da attivare'}
                    </p>
                    <p className="text-[10px] text-[#8E867B]">+ feed .ics pronto</p>
                  </div>
                </div>

                {/* Appelli non ancora validati */}
                {tUnvalidated.length > 0 ? (
                  <div className="rounded-xl border border-[#EBC3C0] bg-[#FEF8F7] p-3.5 space-y-2">
                    <p className="text-xs font-semibold text-[#A63A31] flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {tUnvalidated.length}{' '}
                      {tUnvalidated.length === 1
                        ? 'lezione in attesa di validazione'
                        : 'lezioni in attesa di validazione'}
                    </p>
                    <div className="space-y-1.5">
                      {tUnvalidated.map((sl) => (
                        <button
                          key={sl.id}
                          type="button"
                          onClick={() => onSelectLesson(sl)}
                          className="w-full text-left rounded-lg bg-white border border-[#F0D4D1] px-3 py-1.5 text-xs flex items-center justify-between hover:border-[#B5443A]"
                        >
                          <span className="font-medium text-[#23201D] truncate">{sl.title}</span>
                          <span className="text-[#625B52] tabular-nums shrink-0 ml-2">
                            {formatDateShort(sl.start_time)} ·{' '}
                            {formatTimeRange(sl.start_time, sl.end_time)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-[#EAF4EE] border border-[#BDDAC8] px-3.5 py-2.5 text-xs text-[#2F6649] font-medium">
                    Tutti gli appelli passati risultano regolarmente confermati.
                  </div>
                )}
              </div>

              {/* Azioni WhatsApp 1-Click Docente (SRS 4.2.3) */}
              <div className="flex flex-wrap gap-2 pt-3 border-t border-[#F1ECE3]">
                {t.phone && (
                  <button
                    type="button"
                    onClick={() =>
                      launchWhatsApp({
                        phone: t.phone,
                        recipientName: t.full_name,
                        contextLabel: 'Riepilogo prossimi turni insegnante',
                        message: buildTeacherShiftsMessage(t.full_name, tUpcoming),
                      })
                    }
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#4A6759] px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-[#3A5347] transition-colors"
                  >
                    <WhatsAppIcon className="h-4 w-4" />
                    Invia Riepilogo Turni
                  </button>
                )}
                {waReminderUrl && t.phone && (
                  <button
                    type="button"
                    onClick={() =>
                      launchWhatsApp({
                        phone: t.phone,
                        recipientName: t.full_name,
                        contextLabel: 'Sollecito validazione appelli aperti',
                        message: buildTeacherValidationReminderMessage(t.full_name, tUnvalidated),
                      })
                    }
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#B5443A] px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-[#99352C] transition-colors"
                  >
                    <WhatsAppIcon className="h-4 w-4" />
                    Sollecita Appello
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Modale Insegnante */}
      <Modal
        open={Boolean(modalTarget)}
        onClose={() => setModalTarget(null)}
        title={modalTarget === 'NEW' ? 'Nuova Insegnante (Staff)' : 'Modifica Profilo Insegnante'}
        subtitle="Accesso limitato ai corsi assegnati e alle sale, zero visibilità su prezzi e pacchetti"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#625B52] mb-1">Nome e Cognome</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Email login</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Telefono E.164 (WhatsApp)
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+393381234567"
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                {modalTarget === 'NEW' ? 'Password iniziale' : 'Nuova password (opzionale)'}
              </label>
              <input
                type="text"
                required={modalTarget === 'NEW'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={modalTarget === 'NEW' ? 'Staff2026!' : 'Lascia vuoto per invariata'}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Colore calendario
              </label>
              <div className="flex items-center gap-2 pt-1.5">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full transition-transform ${
                      color === c ? 'ring-2 ring-offset-2 ring-[#23201D] scale-110' : ''
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Colore ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalTarget(null)}
              className="rounded-xl border border-[#DED6C8] px-4 py-2 text-sm text-[#625B52]"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#4A6759] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
            >
              Salva Profilo
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
