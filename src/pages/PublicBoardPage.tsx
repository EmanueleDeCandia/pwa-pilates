import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Link2,
  MapPin,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { BrandMark, WhatsAppIcon } from '../components/BrandMark';
import { Modal } from '../components/Modal';
import { apiFetch, copyTextToClipboard } from '../lib/api';
import {
  buildPublicInquiryMessage,
  buildWhatsAppUrl,
  formatDateLong,
  formatTimeRange,
} from '../lib/format';
import type { PublicCourseSlot } from '../../shared/types';

interface PublicBoardResponse {
  studio: {
    studio_name: string;
    studio_subtitle: string;
    studio_city: string;
    owner_whatsapp: string;
  };
  courses: PublicCourseSlot[];
}

export function PublicBoardPage({
  onBackToApp,
  isLoggedIn,
}: {
  onBackToApp: () => void;
  isLoggedIn: boolean;
}) {
  const [data, setData] = useState<PublicBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [roomFilter, setRoomFilter] = useState<string>('ALL');

  // Modale Richiesta Posto Zero-Login + Contatto Diretto WhatsApp (SRS 1 & 4.1)
  const [selectedCourse, setSelectedCourse] = useState<PublicCourseSlot | 'GENERAL' | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('+39');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedMsg, setSubmittedMsg] = useState<string | null>(null);
  const [copiedWhat, setCopiedWhat] = useState<'msg' | 'link' | null>(null);

  const loadBoard = () => {
    apiFetch<PublicBoardResponse>('/api/public/availability')
      .then((res) => setData(res))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBoard();
  }, []);

  const openInquiryModal = (target: PublicCourseSlot | 'GENERAL') => {
    setSelectedCourse(target);
    setFirstName('');
    setLastName('');
    setPhone('+39');
    setNotes('');
    setSubmitError(null);
    setSubmittedMsg(null);
    setCopiedWhat(null);
  };

  const getPrefilledWhatsAppText = (): string => {
    if (!selectedCourse || !data) return '';
    if (selectedCourse === 'GENERAL') {
      const who =
        firstName.trim() || lastName.trim()
          ? ` Sono ${firstName.trim()} ${lastName.trim()}.`
          : '';
      return `Ciao!${who} Vorrei ricevere informazioni sui prossimi corsi di Pilates disponibili presso ${data.studio.studio_name}.`;
    }
    const base = buildPublicInquiryMessage(selectedCourse);
    const who =
      firstName.trim() || lastName.trim()
        ? ` Mi chiamo ${`${firstName.trim()} ${lastName.trim()}`.trim()}.`
        : '';
    const extra = notes.trim() ? ` Nota: ${notes.trim()}` : '';
    return `${base}${who}${extra}`;
  };

  const handleSubmitInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch<{ id: string; message: string }>('/api/public/inquiries', {
        method: 'POST',
        body: JSON.stringify({
          lesson_slot_id:
            selectedCourse && selectedCourse !== 'GENERAL' ? selectedCourse.id : null,
          first_name: firstName,
          last_name: lastName,
          phone,
          notes,
        }),
      });
      setSubmittedMsg(res.message);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Impossibile inviare la richiesta.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (kind: 'msg' | 'link', value: string) => {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedWhat(kind);
      setTimeout(() => setCopiedWhat(null), 2200);
    }
  };

  const rooms = Array.from(new Set((data?.courses || []).map((c) => c.room_name)));
  const filtered = (data?.courses || []).filter(
    (c) => roomFilter === 'ALL' || c.room_name === roomFilter
  );

  const waMessage = getPrefilledWhatsAppText();
  const waHref = data?.studio.owner_whatsapp
    ? buildWhatsAppUrl(data.studio.owner_whatsapp, waMessage)
    : '';

  return (
    <div className="min-h-dvh bg-[#F8F6F2] text-[#23201D]">
      {/* Header editoriale */}
      <header className="border-b border-[#E8E2D9] bg-white/85 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark size={38} />
            <div>
              <p className="font-display text-xl font-semibold leading-none">
                {data?.studio.studio_name || 'Atelier Élan'}
              </p>
              <p className="text-[11px] text-[#8E867B] mt-0.5">
                {data?.studio.studio_subtitle || 'Studio Pilates & Danza Sportiva'}
                {data?.studio.studio_city ? ` · ${data.studio.studio_city}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onBackToApp}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DED6C8] bg-[#F8F6F2] px-3.5 py-1.5 text-xs font-medium text-[#625B52] hover:text-[#23201D] hover:border-[#C7BCAE] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {isLoggedIn ? 'Torna al Gestionale' : 'Area Staff'}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-10 sm:py-14 space-y-10">
        {/* Hero sereno */}
        <section className="rounded-3xl bg-[#4A6759] text-[#F8F6F2] px-6 py-10 sm:px-12 sm:py-12 relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -bottom-20 h-72 w-72 rounded-full border border-[#F8F6F2]/15"
          />
          <div className="relative z-10 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F8F6F2]/14 px-3 py-1 text-xs font-medium text-[#E5C9B8]">
              <Sparkles className="h-3.5 w-3.5" />
              Bacheca Disponibilità Aggiornata in Tempo Reale
            </span>
            <h1 className="mt-4 font-display text-4xl sm:text-5xl font-medium leading-[1.08]">
              Corsi Mirati &amp; Piccoli Gruppi di Pilates
            </h1>
            <p className="mt-3 text-sm sm:text-base text-[#DCE5DF] leading-relaxed">
              Consulta i posti disponibili per le nostre lezioni specialistiche Reformer,
              Posturale e Sbarra. Nessuna registrazione richiesta: invia una richiesta rapida alla
              segreteria oppure contatta direttamente la Titolare su WhatsApp.
            </p>
          </div>
        </section>

        {/* Filtro Sale */}
        {rooms.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setRoomFilter('ALL')}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                roomFilter === 'ALL'
                  ? 'bg-[#23201D] text-white'
                  : 'bg-white border border-[#E2DACD] text-[#625B52] hover:text-[#23201D]'
              }`}
            >
              Tutte le Sale ({data?.courses.length || 0})
            </button>
            {rooms.map((rm) => (
              <button
                key={rm}
                type="button"
                onClick={() => setRoomFilter(rm)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                  roomFilter === rm
                    ? 'bg-[#23201D] text-white'
                    : 'bg-white border border-[#E2DACD] text-[#625B52] hover:text-[#23201D]'
                }`}
              >
                {rm}
              </button>
            ))}
          </div>
        )}

        {/* Griglia Corsi Mirati */}
        {loading ? (
          <div className="py-16 text-center text-sm text-[#8E867B]">
            Caricamento disponibilità in corso...
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#E8E2D9] bg-white p-12 text-center space-y-3">
            <p className="font-display text-2xl text-[#23201D]">Nuovi corsi mirati in arrivo</p>
            <p className="text-sm text-[#625B52] max-w-md mx-auto">
              Al momento non sono pubblicati slot speciali per questo filtro. Contattaci per
              conoscere gli orari disponibili in settimana.
            </p>
            {data?.studio.owner_whatsapp && (
              <button
                type="button"
                onClick={() => openInquiryModal('GENERAL')}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#4A6759] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#3A5347]"
              >
                <WhatsAppIcon className="h-4 w-4" />
                Contatta la Segreteria
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filtered.map((course) => {
              const soldOut = course.remaining_spots <= 0;

              return (
                <article
                  key={course.id}
                  className="rounded-2xl border border-[#E8E2D9] bg-white p-6 flex flex-col justify-between shadow-xs hover:border-[#CFC4B4] transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F0E8] px-3 py-1 text-xs font-medium text-[#625B52]">
                        <MapPin className="h-3.5 w-3.5 text-[#4A6759]" />
                        {course.room_name}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tabular-nums ${
                          soldOut
                            ? 'bg-[#FBECEB] text-[#A63A31]'
                            : course.remaining_spots <= 2
                              ? 'bg-[#FCF4E6] text-[#9A651C]'
                              : 'bg-[#EAF4EE] text-[#2F6649]'
                        }`}
                      >
                        <Users className="h-3.5 w-3.5" />
                        {soldOut
                          ? 'Completo'
                          : `${course.remaining_spots} ${
                              course.remaining_spots === 1 ? 'posto libero' : 'posti liberi'
                            } su ${course.max_capacity}`}
                      </span>
                    </div>

                    <h2 className="font-display text-2xl font-semibold text-[#23201D] leading-snug">
                      {course.title}
                    </h2>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#625B52]">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#23201D]">
                        <Calendar className="h-3.5 w-3.5 text-[#4A6759]" />
                        {formatDateLong(course.start_time)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Clock className="h-3.5 w-3.5 text-[#4A6759]" />
                        {formatTimeRange(course.start_time, course.end_time)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: course.teacher_color }}
                        />
                        con {course.teacher_first_name}
                      </span>
                    </div>

                    {course.notes && (
                      <p className="mt-3 text-sm text-[#625B52] leading-relaxed">{course.notes}</p>
                    )}
                  </div>

                  <div className="mt-6 pt-4 border-t border-[#F1ECE3] flex items-center justify-between gap-3">
                    <span className="text-xs text-[#8E867B]">
                      {soldOut ? 'Lista d’attesa disponibile' : 'Assegnazione diretta in segreteria'}
                    </span>
                    <button
                      type="button"
                      onClick={() => openInquiryModal(course)}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                        soldOut
                          ? 'border border-[#DED6C8] bg-[#F8F6F2] text-[#625B52] hover:text-[#23201D]'
                          : 'bg-[#4A6759] text-white hover:bg-[#3A5347]'
                      }`}
                    >
                      <WhatsAppIcon className="h-4 w-4" />
                      {soldOut ? 'Lista d’attesa' : 'Richiedi Posto'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Modale Zero-Login Richiesta Posto + WhatsApp Diretto */}
      <Modal
        open={Boolean(selectedCourse)}
        onClose={() => setSelectedCourse(null)}
        title={
          selectedCourse && selectedCourse !== 'GENERAL'
            ? selectedCourse.remaining_spots <= 0
              ? 'Richiedi Lista d’Attesa'
              : 'Richiedi Posto al Corso'
            : 'Contatta la Segreteria'
        }
        subtitle="Nessuna registrazione richiesta: lascia il tuo recapito WhatsApp alla Titolare"
        maxWidth="lg"
      >
        <div className="space-y-5">
          {/* Riepilogo Corso */}
          {selectedCourse && selectedCourse !== 'GENERAL' && (
            <div className="rounded-xl bg-[#F8F6F2] border border-[#E8E2D9] p-3.5 space-y-1">
              <p className="text-sm font-semibold text-[#23201D]">{selectedCourse.title}</p>
              <p className="text-xs text-[#625B52]">
                {formatDateLong(selectedCourse.start_time)} ·{' '}
                {formatTimeRange(selectedCourse.start_time, selectedCourse.end_time)} ·{' '}
                {selectedCourse.room_name} (con {selectedCourse.teacher_first_name})
              </p>
            </div>
          )}

          {submittedMsg ? (
            <div className="rounded-2xl border border-[#C9DBD0] bg-[#EAF4EE] p-5 space-y-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-[#2F6649] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#23201D]">
                    Richiesta inviata alla Segreteria!
                  </p>
                  <p className="text-xs text-[#2F6649] mt-1 leading-relaxed">{submittedMsg}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedCourse(null);
                  loadBoard();
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3A5347]"
              >
                Chiudi
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmitInquiry} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">Nome</label>
                  <input
                    type="text"
                    required
                    placeholder="Es. Francesca"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">Cognome</label>
                  <input
                    type="text"
                    required
                    placeholder="Es. Lombardi"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#625B52] mb-1">
                  Numero WhatsApp (per ricevere la conferma)
                </label>
                <input
                  type="tel"
                  required
                  placeholder="+393401234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#625B52] mb-1">
                  Messaggio o esigenze posturali (opzionale)
                </label>
                <input
                  type="text"
                  placeholder="Es. Prima lezione Reformer, preferenza orario..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm"
                />
              </div>

              {submitError && (
                <p className="rounded-xl bg-[#FBECEB] border border-[#EFCBC8] px-3 py-2 text-xs text-[#A63A31]">
                  {submitError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#4A6759] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {submitting
                  ? 'Invio in corso...'
                  : 'Invia Richiesta Posto alla Segreteria'}
              </button>
            </form>
          )}

          {/* Contatto Diretto WhatsApp (wa.me — SRS 4.1) */}
          {data?.studio.owner_whatsapp && (
            <div className="pt-4 border-t border-[#EFEAE1] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#23201D] flex items-center gap-1.5">
                  <WhatsAppIcon className="h-3.5 w-3.5 text-[#4A6759]" />
                  Oppure scrivi direttamente su WhatsApp ({data.studio.owner_whatsapp})
                </p>
              </div>
              <p className="rounded-xl bg-[#F8F6F2] border border-[#EAE4DA] px-3 py-2 text-xs text-[#625B52] leading-relaxed">
                {waMessage}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#C9DBD0] bg-[#EDF2EE] px-3.5 py-2 text-xs font-semibold text-[#2F6649] hover:bg-[#DFECE3]"
                >
                  <WhatsAppIcon className="h-3.5 w-3.5" />
                  Apri WhatsApp
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  onClick={() => handleCopy('msg', waMessage)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-xs font-medium text-[#23201D] hover:bg-[#F4F0E8]"
                >
                  {copiedWhat === 'msg' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#2F6649]" />
                      Messaggio Copiato
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-[#4A6759]" />
                      Copia Messaggio
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy('link', waHref)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-xs font-medium text-[#625B52] hover:text-[#23201D]"
                >
                  {copiedWhat === 'link' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#2F6649]" />
                      Link Copiato
                    </>
                  ) : (
                    <>
                      <Link2 className="h-3.5 w-3.5" />
                      Copia Link wa.me
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
