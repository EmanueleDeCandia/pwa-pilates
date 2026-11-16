import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch, downloadAuthenticatedFile, setStoredToken } from '../../lib/api';
import {
  AUDIT_ACTION_LABELS,
  formatDateNumeric,
  formatTime,
} from '../../lib/format';
import type {
  AdminDashboardData,
  AuditLogEntry,
  AuthUser,
  StudioSettings,
  TeacherSummary,
} from '../../../shared/types';

interface AdminAuditExportProps {
  user: AuthUser;
  teachers: TeacherSummary[];
  onUserReplaced: (u: AuthUser) => void;
  onGlobalReset: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
  syncTick: number;
}

export function AdminAuditExport({
  user,
  teachers,
  onUserReplaced,
  onGlobalReset,
  notify,
  syncTick,
}: AdminAuditExportProps) {
  const [section, setSection] = useState<'audit' | 'export' | 'database'>('audit');
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [actorFilter, setActorFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');

  const [dbInfo, setDbInfo] = useState<AdminDashboardData['db_info'] | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadLogs = useCallback(async () => {
    const q = new URLSearchParams({ limit: '150' });
    if (actorFilter !== 'ALL') q.set('actorId', actorFilter);
    if (actionFilter !== 'ALL') q.set('actionType', actionFilter);
    try {
      const res = await apiFetch<{ logs: AuditLogEntry[] }>(`/api/audit-logs?${q.toString()}`);
      setLogs(res.logs);
    } catch {
      // ignore
    }
  }, [actorFilter, actionFilter]);

  const loadMeta = useCallback(async () => {
    try {
      const [dashRes, cfgRes] = await Promise.all([
        apiFetch<AdminDashboardData>('/api/dashboard/admin?period=week'),
        apiFetch<{ settings: StudioSettings }>('/api/settings'),
      ]);
      setDbInfo(dashRes.db_info);
      setSettings(cfgRes.settings);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (syncTick > 0) {
      loadLogs();
      if (section === 'database') loadMeta();
    }
  }, [syncTick]);

  const triggerDownload = async (url: string, filename: string, label: string) => {
    try {
      await downloadAuthenticatedFile(url, filename);
      notify('success', `${label} scaricato con successo.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore durante il download.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSavingSettings(true);
    try {
      const res = await apiFetch<{ settings: StudioSettings }>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      notify('success', 'Impostazioni studio salvate nel database locale.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore salvataggio impostazioni.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleResetDemoDb = async () => {
    setResetting(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthUser }>('/api/admin/db/reset-demo', {
        method: 'POST',
      });
      setStoredToken(res.token);
      onUserReplaced(res.user);
      setConfirmReset(false);
      onGlobalReset();
      await Promise.all([loadLogs(), loadMeta()]);
      notify('success', 'Database locale SQLite ripristinato ai dati dimostrativi iniziali.');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile ripristinare il DB.');
    } finally {
      setResetting(false);
    }
  };

  const formatMetaDetails = (log: AuditLogEntry): string => {
    const m = log.metadata;
    const parts: string[] = [];
    if (m.lesson_title) parts.push(`Corso: ${m.lesson_title}`);
    if (m.room_name) parts.push(`${m.room_name}`);
    if (m.student_name) parts.push(`Allievo: ${m.student_name}`);
    if (m.present_count !== undefined)
      parts.push(`${m.present_count} presenti, ${m.absent_count ?? 0} assenti`);
    if (m.previous_status && m.new_status)
      parts.push(`${m.previous_status} → ${m.new_status}`);
    if (m.package_name) parts.push(`${m.package_name}`);
    if (m.reason) parts.push(`Motivo: ${m.reason}`);
    if (m.note) parts.push(`Nota: "${m.note}"`);
    return parts.join(' · ') || '—';
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[#8E867B]">
          Controllo Attività, Contabilità &amp; Ambiente Locale
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#23201D] mt-0.5">
          Audit Log, Esportazioni &amp; Database
        </h1>
      </div>

      {/* Sub-navigation */}
      <div className="inline-flex flex-wrap rounded-xl bg-[#EFEAE1] p-1 text-xs font-medium gap-1">
        <button
          type="button"
          onClick={() => setSection('audit')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 transition-all ${
            section === 'audit' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          Audit Log Attività
        </button>
        <button
          type="button"
          onClick={() => setSection('export')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 transition-all ${
            section === 'export' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
          }`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Export CSV / Excel
        </button>
        <button
          type="button"
          onClick={() => setSection('database')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 transition-all ${
            section === 'database' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
          }`}
        >
          <Database className="h-3.5 w-3.5" />
          Database Locale &amp; Studio
        </button>
      </div>

      {/* TAB 1: AUDIT LOG FILTRABILE (SRS 2.7 & 4.4.6) */}
      {section === 'audit' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-[#8E867B]" />
            <select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              className="rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-xs text-[#23201D]"
            >
              <option value="ALL">Tutti gli utenti (Titolare + Insegnanti)</option>
              <option value={user.id}>{user.full_name} (Titolare)</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name} (Insegnante)
                </option>
              ))}
            </select>

            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-xs text-[#23201D]"
            >
              <option value="ALL">Tutte le azioni</option>
              <option value="ATTENDANCE_VALIDATED">Appelli Validati (Docenti)</option>
              <option value="CREDIT_DEDUCTED">Lezioni Scalate</option>
              <option value="CREDIT_FROZEN">Lezioni Congelate</option>
              <option value="RESCHEDULE_REQUESTED">Richieste Spostamento</option>
              <option value="BOOKING_RESCHEDULED">Lezioni Riprogrammate</option>
              <option value="LESSON_UNLOCKED">Appelli Sbloccati</option>
              <option value="PAYMENT_UPDATED">Pagamenti Registrati</option>
            </select>

            <span className="ml-auto text-xs text-[#8E867B] tabular-nums">
              {logs.length} eventi registrati
            </span>
          </div>

          <div className="rounded-2xl border border-[#E8E2D9] bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF8F4] border-b border-[#EFEAE1] text-[#8E867B] uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Timestamp Esatto</th>
                    <th className="px-4 py-3 font-semibold">Operatore</th>
                    <th className="px-4 py-3 font-semibold">Azione</th>
                    <th className="px-4 py-3 font-semibold">Dettagli &amp; Transizione Stato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3EFE7]">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#FCFBF9]">
                      <td className="px-4 py-3 tabular-nums whitespace-nowrap text-[#625B52]">
                        <strong className="text-[#23201D]">
                          {formatDateNumeric(log.created_at)}
                        </strong>{' '}
                        · {formatTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-semibold text-[#23201D]">{log.actor_name}</span>
                        <span className="ml-1.5 rounded-full bg-[#F4F0E8] px-2 py-0.5 text-[10px] text-[#625B52]">
                          {log.actor_role === 'ADMIN' ? 'Titolare' : 'Staff'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                            log.action_type === 'ATTENDANCE_VALIDATED'
                              ? 'bg-[#EAF4EE] text-[#2F6649]'
                              : log.action_type === 'LESSON_UNLOCKED'
                                ? 'bg-[#FBECEB] text-[#A63A31]'
                                : log.action_type === 'CREDIT_FROZEN'
                                  ? 'bg-[#EBF1F5] text-[#3E5D73]'
                                  : 'bg-[#F4F0E8] text-[#625B52]'
                          }`}
                        >
                          {AUDIT_ACTION_LABELS[log.action_type] || log.action_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#625B52]">{formatMetaDetails(log)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BACKUP ED ESPORTAZIONE CONTABILE CSV / EXCEL (SRS 5) */}
      {section === 'export' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 rounded-2xl border border-[#C9DBD0] bg-[#EDF2EE]/70 p-6 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#3B5448]">
                Contabilità Fiscale Completa
              </span>
              <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                Cartella Excel Multi-Foglio (.xls)
              </h2>
              <p className="text-xs text-[#4A6759]">
                Unico file pronto per il commercialista contenente 3 fogli formattati: Registro
                Incassi, Registro Pacchetti (con analisi presenze/assenze) e Registro Presenze.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                triggerDownload(
                  '/api/export/contabilita.xls',
                  'contabilita-atelier-elan.xls',
                  'Cartella Excel contabilità'
                )
              }
              className="inline-flex items-center gap-2 rounded-xl bg-[#4A6759] px-5 py-3 text-xs font-semibold text-white hover:bg-[#3A5347] shadow-xs"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Scarica Excel Completo
            </button>
          </div>

          {[
            {
              title: 'Registro Incassi e Saldi (.csv)',
              desc: 'Elenco pacchetti venduti con importo totale, versato, residuo da incassare e stato pagamento (UTF-8 BOM per Excel).',
              url: '/api/export/revenue.csv',
              file: 'registro-incassi-pilates.csv',
            },
            {
              title: 'Registro Pacchetti & Crediti (.csv)',
              desc: 'Dettaglio completo crediti totali, lezioni usate, assenze scalate, lezioni congelate e date di scadenza.',
              url: '/api/export/packages.csv',
              file: 'registro-pacchetti-pilates.csv',
            },
            {
              title: 'Registro Presenze & Appelli (.csv)',
              desc: 'Storico cronologico di tutte le lezioni, esiti presenza per studente e timestamp di validazione docenti.',
              url: '/api/export/attendance.csv',
              file: 'registro-presenze-pilates.csv',
            },
            {
              title: 'Backup Integrale Database Locale (.json)',
              desc: 'Snapshot completo di tutte le tabelle locali (sale, studenti, pacchetti, lezioni, prenotazioni e audit log).',
              url: '/api/export/backup.json',
              file: 'backup-locale-pilates.json',
            },
          ].map((item) => (
            <div
              key={item.url}
              className="rounded-2xl border border-[#E8E2D9] bg-white p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <h3 className="text-sm font-semibold text-[#23201D] flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#4A6759]" />
                  {item.title}
                </h3>
                <p className="mt-1.5 text-xs text-[#625B52] leading-relaxed">{item.desc}</p>
              </div>
              <button
                type="button"
                onClick={() => triggerDownload(item.url, item.file, item.title)}
                className="self-start inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-[#F8F6F2] px-3.5 py-2 text-xs font-semibold text-[#23201D] hover:bg-[#EFEAE1]"
              >
                <Download className="h-3.5 w-3.5 text-[#4A6759]" />
                Esporta
              </button>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: CONSOLE DATABASE LOCALE PRE-PRODUZIONE + IMPOSTAZIONI STUDIO (SRS 5) */}
      {section === 'database' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 rounded-2xl border border-[#E8E2D9] bg-white p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EAF4EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#2F6649]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#3D7A5A]" />
                  Pre-Produzione Attiva
                </span>
                <h2 className="mt-2 font-display text-2xl font-semibold text-[#23201D]">
                  Database Relazionale Locale
                </h2>
                <p className="text-xs text-[#625B52] mt-1">
                  {dbInfo?.engine} · file persistente <code>{dbInfo?.file_path}</code> (
                  {dbInfo ? `${Math.max(1, Math.round(dbInfo.file_size_bytes / 1024))} KB` : '—'})
                </p>
              </div>
              <Database className="h-6 w-6 text-[#4A6759]" />
            </div>

            {dbInfo && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {Object.entries(dbInfo.counts).map(([table, count]) => (
                  <div
                    key={table}
                    className="rounded-xl bg-[#F8F6F2] border border-[#EAE4DA] p-2.5 text-center"
                  >
                    <p className="text-lg font-bold text-[#23201D] tabular-nums">{count}</p>
                    <p className="text-[10px] text-[#8E867B] truncate">{table}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl bg-[#F8F6F2] p-3.5 text-xs text-[#625B52] space-y-1.5">
              <p className="font-semibold text-[#23201D] flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#4A6759]" />
                Garanzie SRS Sezione 5 attive in locale:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Trigger SQL anti-conflitto su Sala, Docente e Capienza massima.</li>
                <li>
                  Vista isolata <code>staff_bookings_rls_view</code> e policy RLS: nessun token
                  STAFF può leggere <code>packages</code> o dati economici.
                </li>
                <li>Sincronizzazione WebSocket in tempo reale tra Titolare e Insegnanti.</li>
                <li>
                  Schema PostgreSQL/Supabase con policy RLS pronto per il passaggio in produzione.
                </li>
              </ul>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#F1ECE3]">
              <button
                type="button"
                onClick={() =>
                  triggerDownload(
                    '/api/export/supabase-schema.sql',
                    'supabase-production-schema.sql',
                    'Schema PostgreSQL/Supabase'
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] px-3.5 py-2 text-xs font-medium text-[#23201D] hover:bg-[#F4F0E8]"
              >
                <Download className="h-3.5 w-3.5 text-[#4A6759]" />
                Schema SQL Produzione
              </button>

              {!confirmReset ? (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#E6C7BA] bg-[#F9EFEA] px-3.5 py-2 text-xs font-semibold text-[#9A4B34] hover:bg-[#F3E2D9]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Ripristina Dati Demo
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={handleResetDemoDb}
                    className="rounded-lg bg-[#B5443A] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    {resetting ? 'Ripristino...' : 'Conferma Reset'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="rounded-lg border border-[#DED6C8] px-2.5 py-1.5 text-xs text-[#625B52]"
                  >
                    Annulla
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Impostazioni Studio & Parametri Pacchetti */}
          {settings && (
            <form
              onSubmit={handleSaveSettings}
              className="lg:col-span-6 rounded-2xl border border-[#E8E2D9] bg-white p-6 space-y-4"
            >
              <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                Impostazioni Studio &amp; Pacchetti
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">
                    Nome Studio
                  </label>
                  <input
                    type="text"
                    required
                    value={settings.studio_name}
                    onChange={(e) => setSettings({ ...settings, studio_name: e.target.value })}
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">Città</label>
                  <input
                    type="text"
                    value={settings.studio_city}
                    onChange={(e) => setSettings({ ...settings, studio_city: e.target.value })}
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#625B52] mb-1">
                  Numero WhatsApp Titolare (per Bacheca Pubblica, formato E.164)
                </label>
                <input
                  type="tel"
                  required
                  value={settings.owner_whatsapp}
                  onChange={(e) => setSettings({ ...settings, owner_whatsapp: e.target.value })}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm tabular-nums"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">
                    Min lezioni
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={settings.min_package_credits}
                    onChange={(e) =>
                      setSettings({ ...settings, min_package_credits: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">
                    Max lezioni
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={settings.max_package_credits}
                    onChange={(e) =>
                      setSettings({ ...settings, max_package_credits: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">Default</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={settings.default_package_credits}
                    onChange={(e) =>
                      setSettings({ ...settings, default_package_credits: Number(e.target.value) })
                    }
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#625B52] mb-1">
                    Alert rinnovo ≤
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={settings.renewal_alert_threshold}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        renewal_alert_threshold: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#4A6759] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {savingSettings ? 'Salvataggio...' : 'Salva Impostazioni'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
