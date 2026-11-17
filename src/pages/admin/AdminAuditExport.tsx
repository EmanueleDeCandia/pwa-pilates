import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  GraduationCap,
  History,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { apiFetch, downloadAuthenticatedFile, setStoredToken } from '../../lib/api';
import {
  ATTENDANCE_META,
  AUDIT_ACTION_LABELS,
  PAYMENT_META,
  buildWhatsAppUrl,
  formatCurrency,
  formatDateNumeric,
  formatDateShort,
  formatTime,
  formatTimeRange,
} from '../../lib/format';
import type {
  AdminDashboardData,
  AttendanceRegistryRecord,
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
  const [section, setSection] = useState<'attendance' | 'audit' | 'export' | 'database'>('attendance');
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [actorFilter, setActorFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');

  const [dbInfo, setDbInfo] = useState<AdminDashboardData['db_info'] | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Registro Presenze Studio
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRegistryRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [attSearch, setAttSearch] = useState('');
  const [attTeacherFilter, setAttTeacherFilter] = useState('ALL');
  const [attStudentFilter, setAttStudentFilter] = useState('ALL');
  const [attStatusFilter, setAttStatusFilter] = useState('ALL');
  const [attPaymentFilter, setAttPaymentFilter] = useState('ALL');
  const [attPeriodFilter, setAttPeriodFilter] = useState<'ALL' | 'THIS_MONTH' | 'LAST_7_DAYS' | 'TODAY' | 'FUTURE'>('ALL');
  const [showTeacherSummary, setShowTeacherSummary] = useState(false);

  const loadAttendance = useCallback(async () => {
    setLoadingAttendance(true);
    try {
      const res = await apiFetch<{ records: AttendanceRegistryRecord[] }>('/api/reports/attendance');
      setAttendanceRecords(res.records || []);
    } catch {
      // ignore
    } finally {
      setLoadingAttendance(false);
    }
  }, []);

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
    loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (syncTick > 0) {
      loadAttendance();
      loadLogs();
      if (section === 'database') loadMeta();
    }
  }, [syncTick, section, loadAttendance, loadLogs, loadMeta]);

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

  // Calcoli per il Registro Presenze Studio
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);

  const filteredAttendance = attendanceRecords.filter((r) => {
    if (attTeacherFilter !== 'ALL' && r.teacher_id !== attTeacherFilter) return false;
    if (attStudentFilter !== 'ALL' && r.student_id !== attStudentFilter) return false;
    if (attStatusFilter !== 'ALL' && r.attendance_status !== attStatusFilter) return false;
    if (attPaymentFilter !== 'ALL' && r.package_payment_status !== attPaymentFilter) return false;

    const rDate = r.start_time.slice(0, 10);
    if (attPeriodFilter === 'TODAY' && rDate !== todayIso) return false;
    if (attPeriodFilter === 'THIS_MONTH' && rDate < monthStartIso) return false;
    if (attPeriodFilter === 'LAST_7_DAYS' && (rDate < sevenDaysAgoIso || rDate > todayIso))
      return false;
    if (attPeriodFilter === 'FUTURE' && rDate < todayIso) return false;

    if (attSearch.trim()) {
      const q = attSearch.toLowerCase();
      const matchStudent = `${r.student_first_name} ${r.student_last_name}`.toLowerCase().includes(q);
      const matchCourse = r.lesson_title.toLowerCase().includes(q);
      const matchRoom = r.room_name.toLowerCase().includes(q);
      const matchPackage = r.package_name.toLowerCase().includes(q);
      const matchTeacher = r.teacher_name.toLowerCase().includes(q);
      if (!matchStudent && !matchCourse && !matchRoom && !matchPackage && !matchTeacher)
        return false;
    }
    return true;
  });

  // Metriche generali aggregate sul filtro
  const totalSlotsCount = new Set(filteredAttendance.map((r) => r.lesson_slot_id)).size;
  const presentsCount = filteredAttendance.filter((r) => r.attendance_status === 'PRESENT').length;
  const absentDeductedCount = filteredAttendance.filter(
    (r) => r.attendance_status === 'ABSENT_DEDUCTED'
  ).length;
  const absentFrozenCount = filteredAttendance.filter(
    (r) => r.attendance_status === 'ABSENT_FROZEN'
  ).length;
  const pendingCount = filteredAttendance.filter((r) => r.attendance_status === 'PENDING').length;
  const evaluatedCount = presentsCount + absentDeductedCount + absentFrozenCount;
  const attendanceRate =
    evaluatedCount > 0 ? Math.round((presentsCount / evaluatedCount) * 100) : 100;

  // Ore validate vs programmate (calcolate da durate lezioni uniche)
  const uniqueFilteredSlots = Array.from(
    new Map(
      filteredAttendance.map((r) => [
        r.lesson_slot_id,
        { duration_hours: r.duration_hours, is_validated: r.is_validated },
      ])
    ).values()
  );
  const totValidatedHours =
    Math.round(
      uniqueFilteredSlots
        .filter((s) => s.is_validated)
        .reduce((acc, s) => acc + s.duration_hours, 0) * 10
    ) / 10;
  const totScheduledHours =
    Math.round(uniqueFilteredSlots.reduce((acc, s) => acc + s.duration_hours, 0) * 10) / 10;

  // Dati economici per pacchetti coinvolti (senza duplicare i pacchetti per riga)
  const uniquePackagesMap = new Map<
    string,
    { price: number; amount_paid: number; balance_due: number }
  >();
  for (const r of filteredAttendance) {
    if (!uniquePackagesMap.has(r.package_id)) {
      uniquePackagesMap.set(r.package_id, {
        price: r.package_price,
        amount_paid: r.package_amount_paid,
        balance_due: r.package_balance_due,
      });
    }
  }
  const uniquePkgs = Array.from(uniquePackagesMap.values());
  const totContracted = Math.round(uniquePkgs.reduce((acc, p) => acc + p.price, 0) * 100) / 100;
  const totCollected =
    Math.round(uniquePkgs.reduce((acc, p) => acc + p.amount_paid, 0) * 100) / 100;
  const totBalanceDue =
    Math.round(uniquePkgs.reduce((acc, p) => acc + p.balance_due, 0) * 100) / 100;

  // Elenco studenti per menu a tendina
  const studentOptions = Array.from(
    new Map(
      attendanceRecords.map((r) => [
        r.student_id,
        `${r.student_last_name} ${r.student_first_name}`,
      ])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Rendiconto insegnanti calcolato da formule esistenti
  const allKnownTeachers = [
    {
      id: user.id,
      full_name: user.full_name,
      color: user.color || '#4A6759',
      phone: user.phone || '',
    },
    ...teachers,
  ];

  const teacherAnalytics = allKnownTeachers.map((t) => {
    const tRows = filteredAttendance.filter((r) => r.teacher_id === t.id);
    const tSlotMap = new Map<
      string,
      { duration: number; is_validated: boolean; title: string; room: string; start: string }
    >();
    for (const r of tRows) {
      if (!tSlotMap.has(r.lesson_slot_id)) {
        tSlotMap.set(r.lesson_slot_id, {
          duration: r.duration_hours,
          is_validated: r.is_validated,
          title: r.lesson_title,
          room: r.room_name,
          start: r.start_time,
        });
      }
    }
    const tSlots = Array.from(tSlotMap.values());
    const valHours =
      Math.round(
        tSlots.filter((s) => s.is_validated).reduce((acc, s) => acc + s.duration, 0) * 10
      ) / 10;
    const progHours =
      Math.round(
        tSlots.filter((s) => !s.is_validated).reduce((acc, s) => acc + s.duration, 0) * 10
      ) / 10;
    const valLessons = tSlots.filter((s) => s.is_validated).length;
    const progLessons = tSlots.filter((s) => !s.is_validated).length;

    const presents = tRows.filter((r) => r.attendance_status === 'PRESENT').length;
    const absDeducted = tRows.filter((r) => r.attendance_status === 'ABSENT_DEDUCTED').length;
    const absFrozen = tRows.filter((r) => r.attendance_status === 'ABSENT_FROZEN').length;
    const pending = tRows.filter((r) => r.attendance_status === 'PENDING').length;
    const evaluated = presents + absDeducted + absFrozen;
    const rate = evaluated > 0 ? Math.round((presents / evaluated) * 100) : 100;

    return {
      id: t.id,
      name: t.full_name,
      color: t.color,
      phone: t.phone,
      totalSlots: tSlots.length,
      valLessons,
      progLessons,
      valHours,
      progHours,
      totalHours: Math.round((valHours + progHours) * 10) / 10,
      totalBookings: tRows.length,
      presents,
      absDeducted,
      absFrozen,
      pending,
      attendanceRate: rate,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[#8E867B]">
          Controllo Attività, Contabilità &amp; Ambiente Locale
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#23201D] mt-0.5">
          Audit Log, Registro Studio &amp; Database
        </h1>
      </div>

      {/* Sub-navigation */}
      <div className="inline-flex flex-wrap rounded-xl bg-[#EFEAE1] p-1 text-xs font-medium gap-1">
        <button
          type="button"
          onClick={() => setSection('attendance')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 transition-all ${
            section === 'attendance' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
          }`}
        >
          <CalendarCheck className="h-3.5 w-3.5 text-[#4A6759]" />
          Registro Presenze Studio
        </button>
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

      {/* TAB 0: REGISTRO PRESENZE STUDIO (REPORTING DETTAGLIATO) */}
      {section === 'attendance' && (
        <div className="space-y-5">
          {/* CRUSCOTTO KPI FORMULE AGGREGATE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-[#8E867B]">
                <span>Iscrizioni &amp; Presenze</span>
                <Users className="h-4 w-4 text-[#4A6759]" />
              </div>
              <p className="text-2xl font-bold text-[#23201D] tabular-nums">
                {filteredAttendance.length}{' '}
                <span className="text-xs font-normal text-[#8E867B]">registrazioni</span>
              </p>
              <p className="text-[11px] text-[#2F6649] font-medium tabular-nums">
                {presentsCount} presenze convalidate ({attendanceRate}%)
              </p>
            </div>

            <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-[#8E867B]">
                <span>Monte Ore Insegnanti</span>
                <Clock className="h-4 w-4 text-[#4A6759]" />
              </div>
              <p className="text-2xl font-bold text-[#23201D] tabular-nums">
                {totValidatedHours}h{' '}
                <span className="text-xs font-normal text-[#8E867B]">validate</span>
              </p>
              <p className="text-[11px] text-[#625B52] tabular-nums">
                su {totScheduledHours}h programmate in {totalSlotsCount} corsi
              </p>
            </div>

            <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-[#8E867B]">
                <span>Incassato Allievi</span>
                <CreditCard className="h-4 w-4 text-[#2F6649]" />
              </div>
              <p className="text-2xl font-bold text-[#2F6649] tabular-nums">
                {formatCurrency(totCollected)}
              </p>
              <p className="text-[11px] text-[#8E867B] tabular-nums">
                su {formatCurrency(totContracted)} pattuiti ({uniquePkgs.length} pacchetti)
              </p>
            </div>

            <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 space-y-1">
              <div className="flex items-center justify-between text-xs text-[#8E867B]">
                <span>Residuo da Saldare</span>
                <CreditCard className="h-4 w-4 text-[#B86B52]" />
              </div>
              <p
                className={`text-2xl font-bold tabular-nums ${
                  totBalanceDue > 0 ? 'text-[#A63A31]' : 'text-[#2F6649]'
                }`}
              >
                {formatCurrency(totBalanceDue)}
              </p>
              <p className="text-[11px] text-[#8E867B] tabular-nums">
                {uniquePkgs.filter((p) => p.balance_due > 0).length} allievi con pendenze
              </p>
            </div>
          </div>

          {/* BARRA FILTRI DINAMICI & TOGGLE RENDICONTO DOCENTI */}
          <div className="rounded-2xl border border-[#E8E2D9] bg-white p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-[#4A6759]" />
                <h3 className="text-sm font-semibold text-[#23201D]">
                  Filtri e Ricerca Registro Presenze
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTeacherSummary((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                    showTeacherSummary
                      ? 'bg-[#4A6759] text-white shadow-xs'
                      : 'border border-[#DED6C8] bg-[#F8F6F2] text-[#4A6759] hover:bg-[#EAE4DA]'
                  }`}
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  {showTeacherSummary ? 'Torna al Registro Singolo' : 'Riepilogo Ore Docenti'}
                </button>
                {(attTeacherFilter !== 'ALL' ||
                  attStudentFilter !== 'ALL' ||
                  attStatusFilter !== 'ALL' ||
                  attPaymentFilter !== 'ALL' ||
                  attPeriodFilter !== 'ALL' ||
                  attSearch.trim()) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAttTeacherFilter('ALL');
                      setAttStudentFilter('ALL');
                      setAttStatusFilter('ALL');
                      setAttPaymentFilter('ALL');
                      setAttPeriodFilter('ALL');
                      setAttSearch('');
                    }}
                    className="text-xs text-[#A63A31] hover:underline"
                  >
                    Azzera filtri
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
              {/* Ricerca Testuale */}
              <div className="sm:col-span-2 relative">
                <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-[#8E867B]" />
                <input
                  type="text"
                  placeholder="Cerca allievo, corso o sala..."
                  value={attSearch}
                  onChange={(e) => setAttSearch(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] pl-8 pr-3 py-2 text-xs text-[#23201D] placeholder:text-[#8E867B]"
                />
              </div>

              {/* Filtro Docente */}
              <div>
                <select
                  value={attTeacherFilter}
                  onChange={(e) => setAttTeacherFilter(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-2.5 py-2 text-xs text-[#23201D]"
                >
                  <option value="ALL">Tutte le insegnanti</option>
                  <option value={user.id}>{user.full_name} (Titolare)</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filtro Studente */}
              <div>
                <select
                  value={attStudentFilter}
                  onChange={(e) => setAttStudentFilter(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-2.5 py-2 text-xs text-[#23201D]"
                >
                  <option value="ALL">Tutti gli allievi</option>
                  {studentOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Filtro Esito Presenza */}
              <div>
                <select
                  value={attStatusFilter}
                  onChange={(e) => setAttStatusFilter(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-2.5 py-2 text-xs text-[#23201D]"
                >
                  <option value="ALL">Tutti gli esiti</option>
                  <option value="PRESENT">Presenti</option>
                  <option value="ABSENT_DEDUCTED">Assenze scalate</option>
                  <option value="ABSENT_FROZEN">Assenze congelate (recupero)</option>
                  <option value="ABSENT_PENDING_DECISION">In attesa decisione</option>
                  <option value="RESCHEDULE_REQUESTED">Spostamento richiesto</option>
                  <option value="PENDING">In programma</option>
                </select>
              </div>

              {/* Filtro Stato Pagamento */}
              <div>
                <select
                  value={attPaymentFilter}
                  onChange={(e) => setAttPaymentFilter(e.target.value)}
                  className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-2.5 py-2 text-xs text-[#23201D]"
                >
                  <option value="ALL">Tutti i pagamenti</option>
                  <option value="PAID">Saldato</option>
                  <option value="PARTIAL">Acconto / Parziale</option>
                  <option value="UNPAID">Da saldare</option>
                </select>
              </div>
            </div>

            {/* Filtro Temporale Rapido */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
              <span className="text-[#8E867B] text-[11px] mr-1">Periodo:</span>
              {[
                { id: 'ALL', label: 'Tutto lo storico' },
                { id: 'THIS_MONTH', label: 'Questo mese' },
                { id: 'LAST_7_DAYS', label: 'Ultimi 7 giorni' },
                { id: 'TODAY', label: 'Oggi' },
                { id: 'FUTURE', label: 'Lezioni future' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setAttPeriodFilter(p.id as any)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                    attPeriodFilter === p.id
                      ? 'bg-[#4A6759] text-white'
                      : 'bg-[#F4F0E8] text-[#625B52] hover:bg-[#EAE4DA]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <span className="text-[11px] text-[#8E867B] ml-auto tabular-nums">
                Visualizzati <strong>{filteredAttendance.length}</strong> record
              </span>
            </div>
          </div>

          {/* VISTA A: RENDICONTO DOCENTI (FORMULE AGGREGATE DA DATI ESISTENTI) */}
          {showTeacherSummary ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#C6DACD] bg-[#F4F8F5] p-4 text-xs text-[#2F6649] flex items-center justify-between">
                <span>
                  Rendiconto orario e rendimento delle docenti calcolato automaticamente dai registri
                  delle lezioni selezionate.
                </span>
                <span className="font-semibold tabular-nums">
                  {teacherAnalytics.reduce((a, t) => a + t.totalHours, 0).toFixed(1)} ore totali
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {teacherAnalytics.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-2xl border border-[#E8E2D9] bg-white p-5 space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: t.color }}
                        />
                        <h4 className="font-semibold text-sm text-[#23201D]">{t.name}</h4>
                      </div>
                      <span className="rounded-full bg-[#F4F0E8] px-2 py-0.5 text-[10px] font-bold text-[#625B52]">
                        {t.phone || 'Staff'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-xl bg-[#F8F6F2] border border-[#EAE4DA] p-2.5">
                        <p className="text-xl font-bold text-[#2F6649] tabular-nums">
                          {t.valHours}h
                        </p>
                        <p className="text-[10px] text-[#8E867B]">
                          Ore validate ({t.valLessons} corsi)
                        </p>
                      </div>
                      <div className="rounded-xl bg-[#F8F6F2] border border-[#EAE4DA] p-2.5">
                        <p className="text-xl font-bold text-[#625B52] tabular-nums">
                          {t.progHours}h
                        </p>
                        <p className="text-[10px] text-[#8E867B]">
                          In programma ({t.progLessons} corsi)
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-1 border-t border-[#F0EBE1] text-xs">
                      <div className="flex items-center justify-between text-[#625B52]">
                        <span>Iscrizioni allievi totali:</span>
                        <strong className="text-[#23201D] tabular-nums">{t.totalBookings}</strong>
                      </div>
                      <div className="flex items-center justify-between text-[#625B52]">
                        <span>Presenze effettive:</span>
                        <strong className="text-[#2F6649] tabular-nums">{t.presents}</strong>
                      </div>
                      <div className="flex items-center justify-between text-[#625B52]">
                        <span>Assenze (scalate / congelate):</span>
                        <strong className="text-[#B86B52] tabular-nums">
                          {t.absDeducted} / {t.absFrozen}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between text-[#625B52]">
                        <span>Tasso frequenza allievi:</span>
                        <span className="font-bold text-[#2F6649] tabular-nums">
                          {t.attendanceRate}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* VISTA B: TABELLA REGISTRO PRESENZE COMPLETA */
            <div className="rounded-2xl border border-[#E8E2D9] bg-white overflow-hidden shadow-xs">
              {loadingAttendance ? (
                <div className="p-8 text-center text-xs text-[#8E867B]">
                  Caricamento registro presenze in corso...
                </div>
              ) : filteredAttendance.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#8E867B]">
                  Nessuna lezione o presenza corrisponde ai filtri selezionati.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#E8E2D9] bg-[#F8F6F2] text-[11px] font-semibold text-[#8E867B] uppercase tracking-wider">
                        <th className="py-3 px-4">Data &amp; Orario</th>
                        <th className="py-3 px-4">Corso &amp; Sala</th>
                        <th className="py-3 px-4">Docente &amp; Appello</th>
                        <th className="py-3 px-4">Allievo</th>
                        <th className="py-3 px-4">Contabilità Pacchetto</th>
                        <th className="py-3 px-4">Esito Presenza</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0EBE1]">
                      {filteredAttendance.map((r) => {
                        const pm = PAYMENT_META[r.package_payment_status];
                        const am = ATTENDANCE_META[r.attendance_status];
                        const wa = r.student_phone
                          ? buildWhatsAppUrl(
                              r.student_phone,
                              `Ciao ${r.student_first_name}, ti contattiamo da Atelier Élan in merito alla lezione di ${r.lesson_title}.`
                            )
                          : null;

                        return (
                          <tr key={r.id} className="hover:bg-[#FCFBF9] transition-colors">
                            {/* 1. DATA E ORA */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <p className="font-semibold text-[#23201D] tabular-nums">
                                {formatDateNumeric(r.start_time)}
                              </p>
                              <p className="text-[11px] text-[#625B52] tabular-nums">
                                {formatTimeRange(r.start_time, r.end_time)} ·{' '}
                                <span className="text-[#8E867B]">{r.duration_hours}h</span>
                              </p>
                            </td>

                            {/* 2. CORSO E SALA */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-[#23201D]">
                                  {r.lesson_title}
                                </span>
                                {r.is_targeted && (
                                  <span className="rounded bg-[#F5EBE6] px-1.5 py-0.5 text-[10px] font-bold text-[#9A4B34]">
                                    Mirato
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#8E867B] mt-0.5">{r.room_name}</p>
                            </td>

                            {/* 3. DOCENTE E APPELLO */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: r.teacher_color }}
                                />
                                <span className="text-[#23201D] font-medium">{r.teacher_name}</span>
                              </div>
                              <div className="mt-1">
                                {r.is_validated ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#2F6649] bg-[#EAF4EE] px-2 py-0.5 rounded-full">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Chiuso{' '}
                                    {r.validated_at
                                      ? `alle ${formatTime(r.validated_at)}`
                                      : ''}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#8D6B26] bg-[#FAF3E5] px-2 py-0.5 rounded-full border border-[#ECD9B3]">
                                    <Clock className="h-3 w-3" />
                                    {r.start_time < now.toISOString()
                                      ? 'Da convalidare'
                                      : 'In programma'}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 4. ALLIEVO */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <p className="font-semibold text-[#23201D]">
                                {r.student_last_name} {r.student_first_name}
                              </p>
                              {r.student_phone && (
                                <div className="flex items-center gap-1 mt-0.5 text-[11px] text-[#8E867B]">
                                  <span>{r.student_phone}</span>
                                  {wa && (
                                    <a
                                      href={wa}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[#4A6759] hover:underline text-[10px] ml-1"
                                    >
                                      WhatsApp
                                    </a>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* 5. CONTABILITA PACCHETTO & CREDITI (FORMULE DI CALCOLO) */}
                            <td className="py-3.5 px-4">
                              <p className="font-medium text-[#23201D] truncate max-w-[200px]">
                                {r.package_name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {r.package_payment_status === 'PAID' ? (
                                  <span className="rounded-full bg-[#EAF4EE] px-2 py-0.5 text-[10px] font-bold text-[#2F6649]">
                                    Saldato ({formatCurrency(r.package_price)})
                                  </span>
                                ) : r.package_payment_status === 'PARTIAL' ? (
                                  <span className="rounded-full bg-[#FAF3E5] px-2 py-0.5 text-[10px] font-bold text-[#8D6B26] border border-[#ECD9B3]">
                                    Acconto {formatCurrency(r.package_amount_paid)} · Residuo{' '}
                                    {formatCurrency(r.package_balance_due)}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-[#FBECEB] px-2 py-0.5 text-[10px] font-bold text-[#A63A31]">
                                    Da saldare {formatCurrency(r.package_balance_due)}
                                  </span>
                                )}
                                <span className="text-[11px] text-[#625B52] tabular-nums font-semibold">
                                  {r.package_remaining_credits}/{r.package_total_credits} res.
                                </span>
                              </div>
                            </td>

                            {/* 6. ESITO PRESENZA */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 font-bold ${
                                  am ? `${am.bg} ${am.text}` : 'bg-[#EAE4DA] text-[#625B52]'
                                }`}
                              >
                                {am ? am.label : r.attendance_status}
                              </span>
                              {r.reschedule_note && (
                                <p className="mt-1 text-[11px] text-[#625B52] italic max-w-xs truncate">
                                  &ldquo;{r.reschedule_note}&rdquo;
                                </p>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
