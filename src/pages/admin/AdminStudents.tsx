import React, { useCallback, useEffect, useState } from 'react';
import {
  CreditCard,
  Edit3,
  HeartPulse,
  Package as PackageIcon,
  Phone,
  Plus,
  Search,
  UserPlus,
} from 'lucide-react';
import { Modal } from '../../components/Modal';
import { WhatsAppIcon } from '../../components/BrandMark';
import { apiFetch, launchWhatsApp } from '../../lib/api';
import {
  PAYMENT_META,
  buildPackageRenewalMessage,
  buildPaymentReminderMessage,
  buildWhatsAppUrl,
  formatCurrency,
  formatDateNumeric,
  toUtcDateString,
} from '../../lib/format';
import type {
  PackageWithStats,
  PaymentStatus,
  Student,
  StudioSettings,
} from '../../../shared/types';

interface AdminStudentsProps {
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
  syncTick: number;
}

export function AdminStudents({ notify, syncTick }: AdminStudentsProps) {
  const [subTab, setSubTab] = useState<'students' | 'packages'>('students');
  const [students, setStudents] = useState<Student[]>([]);
  const [packages, setPackages] = useState<PackageWithStats[]>([]);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | PaymentStatus>('ALL');
  const [loading, setLoading] = useState(true);

  // Modale Studente (Nuovo / Modifica)
  const [studentModal, setStudentModal] = useState<Student | 'NEW' | null>(null);
  const [sFirst, setSFirst] = useState('');
  const [sLast, setSLast] = useState('');
  const [sPhone, setSPhone] = useState('+39');
  const [sNotes, setSNotes] = useState('');
  const [savingStudent, setSavingStudent] = useState(false);

  // Modale Pacchetto (Nuovo / Aggiorna Pagamento)
  const [pkgModal, setPkgModal] = useState<PackageWithStats | 'NEW' | null>(null);
  const [pStudentId, setPStudentId] = useState('');
  const [pName, setPName] = useState('Pacchetto 10 Lezioni Pilates');
  const [pTotal, setPTotal] = useState(10);
  const [pPrice, setPPrice] = useState(180);
  const [pPayStatus, setPPayStatus] = useState<PaymentStatus>('PAID');
  const [pAmountPaid, setPAmountPaid] = useState(180);
  const [pPurchaseDate, setPPurchaseDate] = useState(toUtcDateString(new Date()));
  const [pExpDate, setPExpDate] = useState('');
  const [savingPkg, setSavingPkg] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [sRes, pRes, cfgRes] = await Promise.all([
        apiFetch<{ students: Student[] }>('/api/students'),
        apiFetch<{ packages: PackageWithStats[] }>('/api/packages'),
        apiFetch<{ settings: StudioSettings }>('/api/settings'),
      ]);
      setStudents(sRes.students);
      setPackages(pRes.packages);
      setSettings(cfgRes.settings);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore caricamento anagrafiche.');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (syncTick > 0) loadData();
  }, [syncTick]);

  const openNewStudent = () => {
    setSFirst('');
    setSLast('');
    setSPhone('+39');
    setSNotes('');
    setStudentModal('NEW');
  };

  const openEditStudent = (s: Student) => {
    setSFirst(s.first_name);
    setSLast(s.last_name);
    setSPhone(s.phone);
    setSNotes(s.medical_notes || '');
    setStudentModal(s);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingStudent(true);
    try {
      if (studentModal === 'NEW') {
        await apiFetch('/api/students', {
          method: 'POST',
          body: JSON.stringify({
            first_name: sFirst,
            last_name: sLast,
            phone: sPhone,
            medical_notes: sNotes,
          }),
        });
        notify('success', `Studente ${sFirst} ${sLast} registrato in anagrafica.`);
      } else if (studentModal) {
        await apiFetch(`/api/students/${studentModal.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            first_name: sFirst,
            last_name: sLast,
            phone: sPhone,
            medical_notes: sNotes,
          }),
        });
        notify('success', 'Scheda studente aggiornata.');
      }
      setStudentModal(null);
      await loadData();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore salvataggio studente.');
    } finally {
      setSavingStudent(false);
    }
  };

  const openNewPackage = (preselectedStudentId?: string) => {
    const defCredits = settings?.default_package_credits || 10;
    setPStudentId(preselectedStudentId || students[0]?.id || '');
    setPTotal(defCredits);
    setPName(`Pacchetto ${defCredits} Lezioni Pilates`);
    setPPrice(180);
    setPPayStatus('PAID');
    setPAmountPaid(180);
    setPPurchaseDate(toUtcDateString(new Date()));
    setPExpDate('');
    setPkgModal('NEW');
  };

  const openEditPackage = (pkg: PackageWithStats) => {
    setPStudentId(pkg.student_id);
    setPName(pkg.name);
    setPTotal(pkg.total_credits);
    setPPrice(pkg.price);
    setPPayStatus(pkg.payment_status);
    setPAmountPaid(pkg.amount_paid);
    setPPurchaseDate(pkg.purchase_date);
    setPExpDate(pkg.expiration_date || '');
    setPkgModal(pkg);
  };

  const handleSavePackage = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPkg(true);
    try {
      const paid =
        pPayStatus === 'PAID' ? pPrice : pPayStatus === 'UNPAID' ? 0 : Number(pAmountPaid);
      if (pkgModal === 'NEW') {
        await apiFetch('/api/packages', {
          method: 'POST',
          body: JSON.stringify({
            student_id: pStudentId,
            name: pName,
            total_credits: Number(pTotal),
            price: Number(pPrice),
            payment_status: pPayStatus,
            amount_paid: paid,
            purchase_date: pPurchaseDate,
            expiration_date: pExpDate || null,
          }),
        });
        notify('success', 'Nuovo pacchetto lezioni attivato.');
      } else if (pkgModal) {
        await apiFetch(`/api/packages/${pkgModal.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: pName,
            total_credits: Number(pTotal),
            price: Number(pPrice),
            payment_status: pPayStatus,
            amount_paid: paid,
            expiration_date: pExpDate || null,
          }),
        });
        notify('success', 'Pacchetto e stato pagamento aggiornati.');
      }
      setPkgModal(null);
      await loadData();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore salvataggio pacchetto.');
    } finally {
      setSavingPkg(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filteredStudents = students.filter(
    (s) =>
      !q ||
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) ||
      s.phone.includes(q) ||
      s.medical_notes.toLowerCase().includes(q)
  );

  const filteredPackages = packages.filter((p) => {
    if (paymentFilter !== 'ALL' && p.payment_status !== paymentFilter) return false;
    if (!q) return true;
    return (
      `${p.student_first_name} ${p.student_last_name}`.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q)
    );
  });

  const totalSold = packages.reduce((a, p) => a + p.price, 0);
  const totalPaid = packages.reduce((a, p) => a + p.amount_paid, 0);
  const totalDue = packages.reduce((a, p) => a + p.balance_due, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#8E867B]">
            Anagrafica, Note Posturali &amp; Contabilità Studenti
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#23201D] mt-0.5">
            Studenti &amp; Pacchetti Lezioni
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openNewPackage()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#4A6759] bg-white px-3.5 py-2 text-xs font-semibold text-[#4A6759] hover:bg-[#EDF2EE] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nuovo Pacchetto
          </button>
          <button
            type="button"
            onClick={openNewStudent}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3A5347] transition-colors shadow-xs"
          >
            <UserPlus className="h-4 w-4" />
            Nuovo Studente
          </button>
        </div>
      </div>

      {/* Tabs + Ricerca */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-[#EFEAE1] p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setSubTab('students')}
            className={`rounded-lg px-4 py-2 transition-all ${
              subTab === 'students' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
            }`}
          >
            Anagrafica Studenti ({students.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('packages')}
            className={`rounded-lg px-4 py-2 transition-all ${
              subTab === 'packages' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
            }`}
          >
            Registro Pacchetti &amp; Incassi ({packages.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 text-[#8E867B] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca nome, telefono, nota posturale..."
            className="w-full rounded-xl border border-[#E2DACD] bg-white pl-10 pr-3.5 py-2 text-xs text-[#23201D] focus:border-[#4A6759] focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-[#8E867B]">Caricamento in corso...</div>
      ) : subTab === 'students' ? (
        /* GRIGLIA STUDENTI */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredStudents.map((s) => {
            const pkg = s.active_package;
            const pm = pkg ? PAYMENT_META[pkg.payment_status] : null;
            const waGeneral = buildWhatsAppUrl(
              s.phone,
              `Ciao ${s.first_name}, ti scriviamo da Atelier Élan Pilates.`
            );

            return (
              <article
                key={s.id}
                className="rounded-2xl border border-[#E8E2D9] bg-white p-5 flex flex-col justify-between gap-4 hover:border-[#D4C9B8] transition-all"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-[#23201D] leading-none">
                        {s.first_name} {s.last_name}
                      </h2>
                      <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[#625B52] tabular-nums">
                        <Phone className="h-3.5 w-3.5 text-[#8E867B]" />
                        {s.phone}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          launchWhatsApp({
                            phone: s.phone,
                            recipientName: `${s.first_name} ${s.last_name}`,
                            contextLabel: 'Comunicazione rapida allievo',
                            message: `Ciao ${s.first_name}, ti scriviamo da Atelier Élan Pilates.`,
                          })
                        }
                        title="Apri chat WhatsApp"
                        className="rounded-lg border border-[#C9DBD0] bg-[#EDF2EE] p-2 text-[#2F6649] hover:bg-[#DFECE3]"
                      >
                        <WhatsAppIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditStudent(s)}
                        title="Modifica anagrafica e note posturali"
                        className="rounded-lg border border-[#E2DACD] p-2 text-[#625B52] hover:bg-[#F4F0E8] hover:text-[#23201D]"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {s.medical_notes ? (
                    <div className="flex items-start gap-2 rounded-xl bg-[#FCF4E6] border border-[#F0DCBA] px-3 py-2 text-xs text-[#8A5A19]">
                      <HeartPulse className="h-4 w-4 shrink-0 mt-0.5 text-[#B86B52]" />
                      <span>{s.medical_notes}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-[#8E867B] italic">
                      Nessuna precauzione posturale segnalata.
                    </p>
                  )}
                </div>

                {/* Riepilogo pacchetto attivo */}
                <div className="rounded-xl bg-[#F8F6F2] border border-[#EAE4DA] p-3.5">
                  {pkg ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#23201D] truncate">
                          {pkg.name}
                        </span>
                        {pm && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pm.bg} ${pm.text} ${pm.border}`}
                          >
                            {pm.label}
                            {pkg.balance_due > 0 ? ` · -${formatCurrency(pkg.balance_due)}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs tabular-nums">
                        <span className="text-[#625B52]">
                          {pkg.present_count} presenze · {pkg.absent_deducted_count} scalate ·{' '}
                          {pkg.absent_frozen_count} congelate
                        </span>
                        <span
                          className={`font-bold ${
                            pkg.remaining_credits <= 2 ? 'text-[#A63A31]' : 'text-[#4A6759]'
                          }`}
                        >
                          {pkg.remaining_credits}/{pkg.total_credits} residue
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <button
                          type="button"
                          onClick={() => openEditPackage(pkg)}
                          className="text-[11px] font-medium text-[#625B52] hover:text-[#23201D] underline underline-offset-2"
                        >
                          Gestisci pagamento / crediti
                        </button>
                        {pkg.remaining_credits <= 2 && (
                          <button
                            type="button"
                            onClick={() => openNewPackage(s.id)}
                            className="text-[11px] font-semibold text-[#4A6759] hover:underline"
                          >
                            + Rinnova pacchetto
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#8E867B]">Nessun pacchetto attivo</span>
                      <button
                        type="button"
                        onClick={() => openNewPackage(s.id)}
                        className="rounded-lg bg-[#4A6759] px-3 py-1 text-xs font-semibold text-white"
                      >
                        + Assegna Pacchetto
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        /* REGISTRO PACCHETTI & CONTABILITÀ INCASSI (protetto da RLS, invisibile a STAFF) */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E8E2D9] bg-white p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'Tutti' },
                  { id: 'UNPAID', label: 'Da saldare' },
                  { id: 'PARTIAL', label: 'Acconto' },
                  { id: 'PAID', label: 'Saldati' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPaymentFilter(f.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    paymentFilter === f.id
                      ? 'bg-[#23201D] text-white'
                      : 'bg-[#F8F6F2] text-[#625B52] hover:text-[#23201D]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
              <span className="text-[#625B52]">
                Totale: <strong className="text-[#23201D]">{formatCurrency(totalSold)}</strong>
              </span>
              <span className="text-[#2F6649]">
                Incassato: <strong>{formatCurrency(totalPaid)}</strong>
              </span>
              <span className="text-[#A63A31]">
                Da saldare: <strong>{formatCurrency(totalDue)}</strong>
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#E8E2D9] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF8F4] border-b border-[#EFEAE1] text-[#8E867B] uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Studente &amp; Pacchetto</th>
                    <th className="px-4 py-3 font-semibold">Crediti</th>
                    <th className="px-4 py-3 font-semibold">Analisi Frequenza</th>
                    <th className="px-4 py-3 font-semibold">Importo / Versato</th>
                    <th className="px-4 py-3 font-semibold">Stato</th>
                    <th className="px-4 py-3 font-semibold text-right">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EFE7]">
                  {filteredPackages.map((p) => {
                    const pm = PAYMENT_META[p.payment_status];
                    const waMsg =
                      p.balance_due > 0
                        ? buildPaymentReminderMessage(
                            p.student_first_name || '',
                            p.name,
                            p.balance_due
                          )
                        : buildPackageRenewalMessage(
                            p.student_first_name || '',
                            p.name,
                            p.remaining_credits
                          );
                    return (
                      <tr key={p.id} className="hover:bg-[#FCFBF9]">
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-sm text-[#23201D]">
                            {p.student_first_name} {p.student_last_name}
                          </p>
                          <p className="text-[#625B52]">{p.name}</p>
                          <p className="text-[11px] text-[#8E867B] tabular-nums">
                            Acquisto {formatDateNumeric(p.purchase_date)}
                            {p.expiration_date
                              ? ` · Scad. ${formatDateNumeric(p.expiration_date)}`
                              : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 tabular-nums">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 font-bold ${
                              p.remaining_credits <= 2
                                ? 'bg-[#FBECEB] text-[#A63A31]'
                                : 'bg-[#EAF4EE] text-[#2F6649]'
                            }`}
                          >
                            {p.remaining_credits} / {p.total_credits}
                          </span>
                          {p.frozen_credits > 0 && (
                            <p className="mt-1 text-[11px] text-[#4B6B82]">
                              {p.frozen_credits} congelat{p.frozen_credits === 1 ? 'a' : 'e'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-[#625B52]">
                          <span className="text-[#2F6649] font-medium">
                            {p.present_count} pres.
                          </span>{' '}
                          · {p.absent_deducted_count} scal. · {p.absent_frozen_count} cong.
                        </td>
                        <td className="px-4 py-3.5 tabular-nums">
                          <p className="font-semibold text-[#23201D]">{formatCurrency(p.price)}</p>
                          <p className="text-[11px] text-[#625B52]">
                            Versato: {formatCurrency(p.amount_paid)}
                            {p.balance_due > 0 && (
                              <span className="text-[#A63A31] font-semibold">
                                {' '}
                                (-{formatCurrency(p.balance_due)})
                              </span>
                            )}
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${pm.bg} ${pm.text} ${pm.border}`}
                          >
                            {pm.label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditPackage(p)}
                              className="rounded-lg border border-[#DED6C8] px-2.5 py-1.5 font-medium text-[#23201D] hover:bg-[#F4F0E8]"
                            >
                              <CreditCard className="h-3.5 w-3.5 inline mr-1 text-[#4A6759]" />
                              Modifica
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
                                    contextLabel: `Pacchetto · ${p.name}`,
                                    message: waMsg,
                                  })
                                }
                                className="rounded-lg border border-[#C9DBD0] bg-[#EDF2EE] p-1.5 text-[#2F6649] hover:bg-[#DFECE3]"
                                title="Invia messaggio WhatsApp"
                              >
                                <WhatsAppIcon className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODALE STUDENTE */}
      <Modal
        open={Boolean(studentModal)}
        onClose={() => setStudentModal(null)}
        title={studentModal === 'NEW' ? 'Nuovo Studente' : 'Modifica Anagrafica Studente'}
        subtitle="Gli studenti non effettuano login: le note posturali sono visibili alle insegnanti"
      >
        <form onSubmit={handleSaveStudent} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Nome</label>
              <input
                type="text"
                required
                value={sFirst}
                onChange={(e) => setSFirst(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Cognome</label>
              <input
                type="text"
                required
                value={sLast}
                onChange={(e) => setSLast(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#625B52] mb-1">
              Telefono WhatsApp (Formato E.164 obbligatorio)
            </label>
            <input
              type="tel"
              required
              value={sPhone}
              onChange={(e) => setSPhone(e.target.value)}
              placeholder="+393401234567"
              className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm tabular-nums focus:border-[#4A6759] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#625B52] mb-1">
              Note mediche / posturali (visibili alle insegnanti in appello)
            </label>
            <textarea
              rows={3}
              value={sNotes}
              onChange={(e) => setSNotes(e.target.value)}
              placeholder="Es. Ernia L4-L5, cervicalgia, gravidanza II trimestre, precauzioni spalla..."
              className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2 text-sm focus:border-[#4A6759] focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStudentModal(null)}
              className="rounded-xl border border-[#DED6C8] px-4 py-2 text-sm text-[#625B52]"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={savingStudent}
              className="rounded-xl bg-[#4A6759] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
            >
              {savingStudent ? 'Salvataggio...' : 'Salva Studente'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODALE PACCHETTO */}
      <Modal
        open={Boolean(pkgModal)}
        onClose={() => setPkgModal(null)}
        title={
          pkgModal === 'NEW' ? 'Emetti Pacchetto Lezioni' : 'Aggiorna Pacchetto & Pagamento'
        }
        subtitle={`Numero lezioni configurabile liberamente (min ${
          settings?.min_package_credits || 1
        } · max ${settings?.max_package_credits || 30} · default ${
          settings?.default_package_credits || 10
        })`}
      >
        <form onSubmit={handleSavePackage} className="space-y-4">
          {pkgModal === 'NEW' && (
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Studente</label>
              <select
                required
                value={pStudentId}
                onChange={(e) => setPStudentId(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Nome pacchetto
              </label>
              <input
                type="text"
                required
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                N° Lezioni
              </label>
              <input
                type="number"
                min={settings?.min_package_credits || 1}
                max={settings?.max_package_credits || 30}
                required
                value={pTotal}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPTotal(v);
                  if (pkgModal === 'NEW' && pName.startsWith('Pacchetto ')) {
                    setPName(`Pacchetto ${v} Lezioni Pilates`);
                  }
                }}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm tabular-nums focus:border-[#4A6759] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Prezzo (€)</label>
              <input
                type="number"
                min={0}
                step="0.5"
                required
                value={pPrice}
                onChange={(e) => {
                  const pr = Number(e.target.value);
                  setPPrice(pr);
                  if (pPayStatus === 'PAID') setPAmountPaid(pr);
                }}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm tabular-nums focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Stato pagamento
              </label>
              <select
                value={pPayStatus}
                onChange={(e) => {
                  const st = e.target.value as PaymentStatus;
                  setPPayStatus(st);
                  if (st === 'PAID') setPAmountPaid(pPrice);
                  if (st === 'UNPAID') setPAmountPaid(0);
                }}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              >
                <option value="PAID">Saldato</option>
                <option value="PARTIAL">Acconto parziale</option>
                <option value="UNPAID">Da saldare</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Importo versato (€)
              </label>
              <input
                type="number"
                min={0}
                max={pPrice}
                step="0.5"
                disabled={pPayStatus !== 'PARTIAL'}
                value={pPayStatus === 'PAID' ? pPrice : pPayStatus === 'UNPAID' ? 0 : pAmountPaid}
                onChange={(e) => setPAmountPaid(Number(e.target.value))}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm tabular-nums disabled:opacity-60 focus:border-[#4A6759] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Data acquisto
              </label>
              <input
                type="date"
                required
                disabled={pkgModal !== 'NEW'}
                value={pPurchaseDate}
                onChange={(e) => setPPurchaseDate(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Scadenza (opzionale)
              </label>
              <input
                type="date"
                value={pExpDate}
                onChange={(e) => setPExpDate(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPkgModal(null)}
              className="rounded-xl border border-[#DED6C8] px-4 py-2 text-sm text-[#625B52]"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={savingPkg}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-5 py-2 text-sm font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
            >
              <PackageIcon className="h-4 w-4" />
              {savingPkg ? 'Salvataggio...' : 'Salva Pacchetto'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
