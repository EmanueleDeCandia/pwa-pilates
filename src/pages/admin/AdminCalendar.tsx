import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  Plus,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';
import { Modal } from '../../components/Modal';
import { TrafficLightBadge } from '../../components/BrandMark';
import { apiFetch } from '../../lib/api';
import {
  addUtcDays,
  formatDateLong,
  formatDateShort,
  formatTime,
  formatTimeRange,
  getMondayOfWeek,
  toUtcDateString,
} from '../../lib/format';
import type {
  FreeSlotSuggestion,
  LessonSlot,
  Room,
  TeacherSummary,
} from '../../../shared/types';

interface AdminCalendarProps {
  rooms: Room[];
  teachers: TeacherSummary[];
  onSelectLesson: (lesson: LessonSlot) => void;
  onMetaChanged: () => void;
  onOpenPublicBoard: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
  syncTick: number;
  autoOpenFreeSlots?: boolean;
  onConsumedAutoFreeSlots?: () => void;
}

const WEEKDAY_CHIPS = [
  { dow: 1, label: 'Lun' },
  { dow: 2, label: 'Mar' },
  { dow: 3, label: 'Mer' },
  { dow: 4, label: 'Gio' },
  { dow: 5, label: 'Ven' },
  { dow: 6, label: 'Sab' },
];

export function AdminCalendar({
  rooms,
  teachers,
  onSelectLesson,
  onMetaChanged,
  onOpenPublicBoard,
  notify,
  syncTick,
  autoOpenFreeSlots,
  onConsumedAutoFreeSlots,
}: AdminCalendarProps) {
  const todayStr = toUtcDateString(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [anchorDate, setAnchorDate] = useState<string>(todayStr);
  const [teacherFilter, setTeacherFilter] = useState<string>('ALL');
  const [lessons, setLessons] = useState<LessonSlot[]>([]);

  // Algoritmo Slot Liberi (SRS 4.1)
  const [showFreeSlots, setShowFreeSlots] = useState(false);
  const [windowStart, setWindowStart] = useState('14:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [minDuration, setMinDuration] = useState(60);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [freeSlots, setFreeSlots] = useState<FreeSlotSuggestion[]>([]);
  const [loadingFree, setLoadingFree] = useState(false);

  // Modale Nuova Lezione / Corso Ricorrente / Corso Mirato
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newRoomId, setNewRoomId] = useState('');
  const [newTeacherId, setNewTeacherId] = useState('');
  const [newDate, setNewDate] = useState(todayStr);
  const [newStart, setNewStart] = useState('15:00');
  const [newEnd, setNewEnd] = useState('16:00');
  const [newCap, setNewCap] = useState(6);
  const [newRepeatWeeks, setNewRepeatWeeks] = useState(1);
  const [newTargeted, setNewTargeted] = useState(false);
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Modale Gestione Sale (SRS 2.2)
  const [roomsModalOpen, setRoomsModalOpen] = useState(false);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [roomName, setRoomName] = useState('');
  const [roomDesc, setRoomDesc] = useState('');
  const [roomCap, setRoomCap] = useState(8);

  const activeRooms = rooms.filter((r) => r.is_active);
  const weekMonday = getMondayOfWeek(anchorDate);

  const loadLessons = useCallback(async () => {
    const start = viewMode === 'day' ? anchorDate : weekMonday;
    const end = viewMode === 'day' ? addUtcDays(anchorDate, 1) : addUtcDays(weekMonday, 7);
    const q = new URLSearchParams({
      from: `${start}T00:00:00.000Z`,
      to: `${end}T00:00:00.000Z`,
    });
    if (teacherFilter !== 'ALL') q.set('teacherId', teacherFilter);
    try {
      const res = await apiFetch<{ lessons: LessonSlot[] }>(`/api/lessons?${q.toString()}`);
      setLessons(res.lessons);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore caricamento calendario.');
    }
  }, [viewMode, anchorDate, weekMonday, teacherFilter, notify]);

  const loadFreeSlots = useCallback(async () => {
    if (!showFreeSlots) return;
    setLoadingFree(true);
    const start = viewMode === 'day' ? anchorDate : weekMonday;
    const end = viewMode === 'day' ? anchorDate : addUtcDays(weekMonday, 5);
    const q = new URLSearchParams({
      startDate: start,
      endDate: end,
      windowStart,
      windowEnd,
      minDuration: String(minDuration),
      weekdays: selectedDays.join(','),
    });
    if (teacherFilter !== 'ALL') q.set('teacherId', teacherFilter);
    try {
      const res = await apiFetch<{ free_slots: FreeSlotSuggestion[] }>(
        `/api/lessons/free-slots?${q.toString()}`
      );
      setFreeSlots(res.free_slots);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore calcolo disponibilità.');
    } finally {
      setLoadingFree(false);
    }
  }, [
    showFreeSlots,
    viewMode,
    anchorDate,
    weekMonday,
    windowStart,
    windowEnd,
    minDuration,
    selectedDays,
    teacherFilter,
    notify,
  ]);

  useEffect(() => {
    loadLessons();
  }, [loadLessons]);

  useEffect(() => {
    loadFreeSlots();
  }, [loadFreeSlots]);

  useEffect(() => {
    if (syncTick > 0) {
      loadLessons();
      if (showFreeSlots) loadFreeSlots();
    }
  }, [syncTick]);

  useEffect(() => {
    if (autoOpenFreeSlots) {
      setShowFreeSlots(true);
      setViewMode('week');
      onConsumedAutoFreeSlots?.();
    }
  }, [autoOpenFreeSlots, onConsumedAutoFreeSlots]);

  useEffect(() => {
    if (rooms.length === 0 || teachers.length === 0) {
      onMetaChanged();
    }
  }, []);

  useEffect(() => {
    if (createOpen) {
      if (!newRoomId && activeRooms[0]?.id) {
        setNewRoomId(activeRooms[0].id);
        setNewCap(activeRooms[0].default_capacity || 6);
      }
      if (!newTeacherId && teachers[0]?.id) {
        setNewTeacherId(teachers[0].id);
      }
    }
  }, [createOpen, activeRooms, teachers, newRoomId, newTeacherId]);

  const openBlankCreate = async (preset?: {
    date?: string;
    start?: string;
    end?: string;
    roomId?: string;
    teacherId?: string;
    targeted?: boolean;
    title?: string;
  }) => {
    let availableRooms = activeRooms;
    let availableTeachers = teachers;
    if (availableRooms.length === 0 || availableTeachers.length === 0) {
      try {
        const [rRes, tRes] = await Promise.all([
          apiFetch<{ rooms: Room[] }>('/api/rooms?all=true'),
          apiFetch<{ teachers: TeacherSummary[] }>('/api/teachers'),
        ]);
        availableRooms = rRes.rooms.filter((r) => r.is_active);
        availableTeachers = tRes.teachers;
        onMetaChanged();
      } catch {
        // gestito sotto
      }
    }
    const rId = preset?.roomId || availableRooms[0]?.id || '';
    const roomObj = availableRooms.find((r) => r.id === rId);
    setNewTitle(preset?.title || '');
    setNewRoomId(rId);
    setNewTeacherId(preset?.teacherId || availableTeachers[0]?.id || '');
    setNewDate(preset?.date || anchorDate);
    setNewStart(preset?.start || '15:00');
    setNewEnd(preset?.end || '16:00');
    setNewCap(roomObj?.default_capacity || 6);
    setNewRepeatWeeks(1);
    setNewTargeted(Boolean(preset?.targeted));
    setNewNotes('');
    setCreateOpen(true);
  };

  // Conversione 1-Click di uno Slot Libero in un nuovo Corso Mirato (SRS 4.1)
  const convertFreeSlotToCourse = (fs: FreeSlotSuggestion) => {
    const startHHMM = formatTime(fs.start_time);
    const startMs = new Date(fs.start_time).getTime();
    const oneHourEnd = new Date(Math.min(new Date(fs.end_time).getTime(), startMs + 60 * 60_000));
    openBlankCreate({
      date: fs.date,
      start: startHHMM,
      end: formatTime(oneHourEnd.toISOString()),
      roomId: fs.available_rooms[0]?.id,
      teacherId: fs.available_teachers[0]?.id,
      targeted: true,
      title: 'Corso Mirato — Pilates Posturale',
    });
  };

  const handleCreateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await apiFetch<{ count: number }>('/api/lessons', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          room_id: newRoomId,
          teacher_id: newTeacherId,
          start_time: `${newDate}T${newStart}:00.000Z`,
          end_time: `${newDate}T${newEnd}:00.000Z`,
          max_capacity: Number(newCap),
          repeat_weeks: Number(newRepeatWeeks),
          is_targeted: newTargeted,
          notes: newNotes,
        }),
      });
      notify(
        'success',
        res.count > 1
          ? `Create ${res.count} occorrenze settimanali senza conflitti di sala o docente.`
          : 'Nuova lezione aggiunta al calendario.'
      );
      setCreateOpen(false);
      await loadLessons();
      if (showFreeSlots) await loadFreeSlots();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Impossibile creare la lezione.');
    } finally {
      setCreating(false);
    }
  };

  const openRoomsConfig = async () => {
    setRoomsModalOpen(true);
    try {
      const res = await apiFetch<{ rooms: Room[] }>('/api/rooms?all=true');
      setAllRooms(res.rooms);
    } catch {
      setAllRooms(rooms);
    }
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: roomName,
          description: roomDesc,
          default_capacity: Number(roomCap),
        }),
      });
      setRoomName('');
      setRoomDesc('');
      setRoomCap(8);
      notify('success', 'Nuova sala aggiunta allo studio.');
      const res = await apiFetch<{ rooms: Room[] }>('/api/rooms?all=true');
      setAllRooms(res.rooms);
      onMetaChanged();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore creazione sala.');
    }
  };

  const handleUpdateRoom = async (room: Room, patch: Partial<Room>) => {
    try {
      await apiFetch(`/api/rooms/${room.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const res = await apiFetch<{ rooms: Room[] }>('/api/rooms?all=true');
      setAllRooms(res.rooms);
      onMetaChanged();
      notify('success', `Sala "${room.name}" aggiornata.`);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Errore aggiornamento sala.');
    }
  };

  const toggleDayChip = (dow: number) => {
    setSelectedDays((prev) =>
      prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow].sort()
    );
  };

  const shiftDate = (dir: -1 | 1) => {
    const delta = viewMode === 'day' ? dir : dir * 7;
    setAnchorDate(addUtcDays(anchorDate, delta));
  };

  const weekDates = Array.from({ length: 6 }, (_, i) => addUtcDays(weekMonday, i));

  return (
    <div className="space-y-6">
      {/* Header Calendario */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#8E867B]">
            Sale, Orari &amp; Corsi Mirati
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#23201D] mt-0.5">
            Calendario Multi-Sala
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenPublicBoard}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-xs font-medium text-[#625B52] hover:text-[#23201D] transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Bacheca Pubblica
          </button>
          <button
            type="button"
            onClick={openRoomsConfig}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-xs font-medium text-[#625B52] hover:text-[#23201D] transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Sale ({activeRooms.length})
          </button>
          <button
            type="button"
            onClick={() => setShowFreeSlots((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold border transition-all ${
              showFreeSlots
                ? 'bg-[#B86B52] text-white border-[#B86B52]'
                : 'bg-[#F9EFEA] text-[#9A4B34] border-[#E6C7BA] hover:bg-[#F3E2D9]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Mostra Disponibilità
          </button>
          <button
            type="button"
            onClick={() => openBlankCreate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#4A6759] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3A5347] shadow-xs transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nuovo Corso
          </button>
        </div>
      </div>

      {/* Barra navigazione data + Vista Giorno/Settimana + Filtro codice colore insegnante */}
      <div className="rounded-2xl border border-[#E8E2D9] bg-white p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftDate(-1)}
            className="rounded-lg border border-[#E8E2D9] p-2 text-[#625B52] hover:bg-[#F4F0E8]"
            aria-label="Periodo precedente"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-44 text-center">
            <p className="text-sm font-semibold text-[#23201D]">
              {viewMode === 'day'
                ? formatDateLong(anchorDate)
                : `${formatDateShort(weekMonday)} – ${formatDateShort(addUtcDays(weekMonday, 5))}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => shiftDate(1)}
            className="rounded-lg border border-[#E8E2D9] p-2 text-[#625B52] hover:bg-[#F4F0E8]"
            aria-label="Periodo successivo"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setAnchorDate(todayStr)}
            className="rounded-lg bg-[#F4F0E8] px-2.5 py-1.5 text-xs font-medium text-[#625B52] hover:text-[#23201D]"
          >
            Oggi
          </button>
        </div>

        {/* Filtro Insegnanti con codice colore */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTeacherFilter('ALL')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              teacherFilter === 'ALL'
                ? 'bg-[#23201D] text-white'
                : 'bg-[#F8F6F2] text-[#625B52] hover:text-[#23201D]'
            }`}
          >
            Tutte
          </button>
          {teachers.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTeacherFilter(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                teacherFilter === t.id
                  ? 'bg-[#23201D] text-white'
                  : 'bg-[#F8F6F2] text-[#625B52] hover:text-[#23201D]'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              {t.full_name.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Vista Giornaliera Affiancata vs Settimanale */}
        <div className="inline-flex rounded-xl bg-[#EFEAE1] p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`rounded-lg px-3 py-1.5 transition-all ${
              viewMode === 'day' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
            }`}
          >
            Giorno (Sale affiancate)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('week')}
            className={`rounded-lg px-3 py-1.5 transition-all ${
              viewMode === 'week' ? 'bg-white text-[#23201D] shadow-xs' : 'text-[#625B52]'
            }`}
          >
            Settimana
          </button>
        </div>
      </div>

      {/* PANNELLO ALGORITMO SLOT LIBERI (Corsi Mirati — SRS 4.1) */}
      {showFreeSlots && (
        <section className="rounded-2xl border border-[#E6C7BA] bg-[#FDF8F5] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#23201D] flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#B86B52]" />
                Rilevamento Automatico Ore Libere
              </h2>
              <p className="text-xs text-[#625B52]">
                Evidenzia i blocchi in cui almeno una sala attiva e almeno un&apos;insegnante sono
                libere contemporaneamente — convertili in un Corso Mirato con un clic.
              </p>
            </div>
            <span className="rounded-full bg-white border border-[#E6C7BA] px-3 py-1 text-xs font-semibold text-[#9A4B34] tabular-nums">
              {loadingFree ? 'Calcolo...' : `${freeSlots.length} finestre libere trovate`}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#625B52] mb-1">
                Dalle ore
              </label>
              <input
                type="time"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                className="rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#625B52] mb-1">Alle ore</label>
              <input
                type="time"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                className="rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#625B52] mb-1">
                Durata minima
              </label>
              <select
                value={minDuration}
                onChange={(e) => setMinDuration(Number(e.target.value))}
                className="rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-xs"
              >
                <option value={45}>45 min</option>
                <option value={60}>60 min (1 ora)</option>
                <option value={90}>90 min</option>
                <option value={120}>120 min (2 ore)</option>
                <option value={180}>180 min (3 ore)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#625B52] mb-1">Giorni</label>
              <div className="flex items-center gap-1">
                {WEEKDAY_CHIPS.map((c) => {
                  const on = selectedDays.includes(c.dow);
                  return (
                    <button
                      key={c.dow}
                      type="button"
                      onClick={() => toggleDayChip(c.dow)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        on
                          ? 'bg-[#B86B52] text-white'
                          : 'bg-white border border-[#DED6C8] text-[#625B52]'
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {freeSlots.length === 0 ? (
            <p className="text-xs text-[#8E867B] py-2">
              Nessuno slot libero nella fascia selezionata. Prova ad ampliare l&apos;orario o la
              settimana.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {freeSlots.map((fs, idx) => (
                <div
                  key={`${fs.start_time}-${idx}`}
                  className="rounded-xl border border-[#E6C7BA] bg-white p-3.5 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#23201D]">
                        {formatDateLong(fs.date)}
                      </span>
                      <span className="rounded-full bg-[#F9EFEA] px-2 py-0.5 text-[11px] font-semibold text-[#9A4B34] tabular-nums">
                        {(fs.duration_minutes / 60).toFixed(fs.duration_minutes % 60 === 0 ? 0 : 1)}h libere
                      </span>
                    </div>
                    <p className="text-sm font-bold text-[#4A6759] tabular-nums">
                      {formatTimeRange(fs.start_time, fs.end_time)}
                    </p>
                    <p className="text-[11px] text-[#625B52]">
                      <strong>Sale:</strong> {fs.available_rooms.map((r) => r.name).join(' · ')}
                    </p>
                    <p className="text-[11px] text-[#625B52]">
                      <strong>Docenti:</strong>{' '}
                      {fs.available_teachers.map((t) => t.full_name.split(' ')[0]).join(', ')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => convertFreeSlotToCourse(fs)}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4A6759] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3A5347] transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Crea Corso Mirato (1-Click)
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* VISTA GIORNALIERA MULTI-RISORSA AFFIANCATA (Sala 1 | Sala 2 — SRS 4.1) */}
      {viewMode === 'day' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {activeRooms.map((room) => {
            const roomSlots = lessons.filter((l) => l.room_id === room.id);
            const roomFree = showFreeSlots
              ? freeSlots.filter(
                  (f) =>
                    f.date === anchorDate && f.available_rooms.some((ar) => ar.id === room.id)
                )
              : [];

            return (
              <section
                key={room.id}
                className="rounded-2xl border border-[#E8E2D9] bg-white overflow-hidden flex flex-col"
              >
                <header className="border-b border-[#EFEAE1] bg-[#FAF8F4] px-5 py-4 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-[#23201D]">
                      {room.name}
                    </h2>
                    <p className="text-xs text-[#8E867B]">
                      Capienza standard: {room.default_capacity} posti
                      {room.description ? ` · ${room.description}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openBlankCreate({ date: anchorDate, roomId: room.id })}
                    className="shrink-0 rounded-xl border border-[#DED6C8] bg-white px-3 py-1.5 text-xs font-medium text-[#4A6759] hover:border-[#4A6759]"
                  >
                    + Aggiungi
                  </button>
                </header>

                <div className="p-4 space-y-3 flex-1">
                  {roomSlots.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#E2DACD] py-10 text-center text-xs text-[#8E867B]">
                      Sala completamente libera in questa giornata.
                    </div>
                  ) : (
                    roomSlots.map((slot) => (
                      <div
                        key={slot.id}
                        onClick={() => onSelectLesson(slot)}
                        style={{ borderLeftColor: slot.teacher_color }}
                        className="rounded-xl border border-[#EAE4DA] border-l-4 bg-[#FCFBF9] p-4 hover:bg-white hover:shadow-xs cursor-pointer transition-all space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-[#23201D] tabular-nums">
                            <Clock className="h-3.5 w-3.5 text-[#4A6759]" />
                            {formatTimeRange(slot.start_time, slot.end_time)}
                          </span>
                          <TrafficLightBadge status={slot.traffic_light} />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-[#23201D]">{slot.title}</h3>
                          {slot.is_targeted && (
                            <span className="rounded-full bg-[#EDF2EE] px-2 py-0.5 text-[10px] font-semibold text-[#3B5448]">
                              Mirato
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs text-[#625B52]">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: slot.teacher_color }}
                            />
                            {slot.teacher_name}
                          </span>
                          <span className="inline-flex items-center gap-1 font-semibold text-[#23201D] tabular-nums">
                            <Users className="h-3.5 w-3.5 text-[#8E867B]" />
                            {slot.active_bookings_count}/{slot.max_capacity}
                          </span>
                        </div>
                      </div>
                    ))
                  )}

                  {roomFree.map((fs, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => convertFreeSlotToCourse(fs)}
                      className="w-full rounded-xl border border-dashed border-[#D8A894] bg-[#FDF6F2] px-4 py-3 text-left flex items-center justify-between gap-2 hover:bg-[#F9ECE4] transition-colors"
                    >
                      <div>
                        <p className="text-xs font-semibold text-[#9A4B34] tabular-nums">
                          Slot libero {formatTimeRange(fs.start_time, fs.end_time)}
                        </p>
                        <p className="text-[11px] text-[#8E867B]">
                          Docenti libere:{' '}
                          {fs.available_teachers.map((t) => t.full_name.split(' ')[0]).join(', ')}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-[#4A6759]">+ Corso Mirato</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        /* VISTA SETTIMANALE MULTI-SALA (Lun - Sab) */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {weekDates.map((dayStr) => {
            const isToday = dayStr === todayStr;
            const dayLessons = lessons.filter((l) => l.start_time.slice(0, 10) === dayStr);
            const dayFree = showFreeSlots ? freeSlots.filter((f) => f.date === dayStr) : [];

            return (
              <section
                key={dayStr}
                className={`rounded-2xl border bg-white flex flex-col overflow-hidden ${
                  isToday ? 'border-[#4A6759] ring-1 ring-[#4A6759]/15' : 'border-[#E8E2D9]'
                }`}
              >
                <header
                  className={`px-4 py-3 border-b border-[#EFEAE1] flex items-center justify-between ${
                    isToday ? 'bg-[#EDF2EE]' : 'bg-[#FAF8F4]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAnchorDate(dayStr);
                      setViewMode('day');
                    }}
                    className="text-left group"
                  >
                    <p className="text-sm font-semibold text-[#23201D] group-hover:text-[#4A6759]">
                      {formatDateLong(dayStr)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => openBlankCreate({ date: dayStr })}
                    className="rounded-lg p-1 text-[#625B52] hover:bg-white hover:text-[#23201D]"
                    title="Aggiungi lezione in questo giorno"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </header>

                <div className="p-3.5 space-y-2.5 flex-1">
                  {dayLessons.length === 0 && dayFree.length === 0 && (
                    <p className="py-6 text-center text-xs text-[#8E867B]">
                      Nessun corso programmato
                    </p>
                  )}

                  {dayLessons.map((slot) => {
                    const dotColor =
                      slot.traffic_light === 'GREEN'
                        ? 'bg-[#3D7A5A]'
                        : slot.traffic_light === 'RED'
                          ? 'bg-[#B5443A]'
                          : slot.traffic_light === 'YELLOW'
                            ? 'bg-[#C4862D]'
                            : 'bg-[#C5BEB2]';

                    return (
                      <div
                        key={slot.id}
                        onClick={() => onSelectLesson(slot)}
                        style={{ borderLeftColor: slot.teacher_color }}
                        className="rounded-xl border border-[#EAE4DA] border-l-4 bg-[#FCFBF9] p-3 hover:bg-white hover:border-[#CFC4B4] cursor-pointer transition-all space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-[#23201D] tabular-nums">
                            {formatTimeRange(slot.start_time, slot.end_time)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-[#625B52] tabular-nums">
                              {slot.active_bookings_count}/{slot.max_capacity}
                            </span>
                            <span
                              className={`h-2 w-2 rounded-full ${dotColor}`}
                              title={slot.traffic_light}
                            />
                          </div>
                        </div>

                        <p className="text-sm font-semibold text-[#23201D] leading-snug">
                          {slot.title}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#625B52]">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-[#4A6759]" />
                            {slot.room_name.replace('Sala 1 — ', 'S1 ').replace('Sala 2 — ', 'S2 ')}
                          </span>
                          <span>{slot.teacher_name.split(' ')[0]}</span>
                        </div>
                      </div>
                    );
                  })}

                  {dayFree.map((fs, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => convertFreeSlotToCourse(fs)}
                      className="w-full rounded-xl border border-dashed border-[#D8A894] bg-[#FDF6F2] px-3 py-2 text-left hover:bg-[#F9ECE4] transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#9A4B34] tabular-nums">
                          Libero {formatTimeRange(fs.start_time, fs.end_time)}
                        </span>
                        <span className="text-[11px] font-semibold text-[#4A6759]">+ Attiva</span>
                      </div>
                      <p className="text-[10px] text-[#8E867B] mt-0.5 truncate">
                        {fs.available_rooms.length} sale ·{' '}
                        {fs.available_teachers.map((t) => t.full_name.split(' ')[0]).join(', ')}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* MODALE CREAZIONE NUOVA LEZIONE / CORSO RICORRENTE */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nuova Lezione o Corso"
        subtitle="Verifica automatica conflitti sala e insegnante in tempo reale"
      >
        <form onSubmit={handleCreateLesson} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#625B52] mb-1">Titolo corso</label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Es. Pilates Reformer Posturale, Sbarra & Core..."
              className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Sala</label>
              <select
                required
                value={newRoomId}
                onChange={(e) => {
                  const id = e.target.value;
                  setNewRoomId(id);
                  const rm = activeRooms.find((r) => r.id === id);
                  if (rm) setNewCap(rm.default_capacity);
                }}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              >
                {activeRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (std {r.default_capacity})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Insegnante</label>
              <select
                required
                value={newTeacherId}
                onChange={(e) => setNewTeacherId(e.target.value)}
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

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Data</label>
              <input
                type="date"
                required
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Inizio</label>
              <input
                type="time"
                required
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm tabular-nums focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">Fine</label>
              <input
                type="time"
                required
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm tabular-nums focus:border-[#4A6759] focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Capienza massima posti
              </label>
              <input
                type="number"
                min={1}
                max={100}
                required
                value={newCap}
                onChange={(e) => setNewCap(Number(e.target.value))}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm tabular-nums focus:border-[#4A6759] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#625B52] mb-1">
                Ricorrenza settimanale
              </label>
              <select
                value={newRepeatWeeks}
                onChange={(e) => setNewRepeatWeeks(Number(e.target.value))}
                className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3 py-2.5 text-sm focus:border-[#4A6759] focus:outline-none"
              >
                <option value={1}>Singola lezione</option>
                <option value={2}>Ogni settimana · 2 settimane</option>
                <option value={4}>Ogni settimana · 4 settimane</option>
                <option value={8}>Ogni settimana · 8 settimane</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#625B52] mb-1">
              Descrizione / note corso (opzionale)
            </label>
            <textarea
              rows={2}
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Visibile all'insegnante e, se corso mirato, sulla Bacheca Pubblica..."
              className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2 text-sm focus:border-[#4A6759] focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2.5 rounded-xl border border-[#E8E2D9] bg-[#F8F6F2] px-3.5 py-2.5 text-xs sm:text-sm text-[#23201D]">
            <input
              type="checkbox"
              checked={newTargeted}
              onChange={(e) => setNewTargeted(e.target.checked)}
              className="h-4 w-4 accent-[#4A6759]"
            />
            <span>
              <strong>Corso Mirato Specialistico</strong> — rendi visibile su Bacheca Pubblica e
              Broadcast WhatsApp
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded-xl border border-[#DED6C8] px-4 py-2.5 text-sm text-[#625B52]"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-[#4A6759] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3A5347] disabled:opacity-50"
            >
              {creating ? 'Salvataggio...' : 'Salva in Calendario'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODALE CONFIGURAZIONE SALE */}
      <Modal
        open={roomsModalOpen}
        onClose={() => setRoomsModalOpen(false)}
        title="Configurazione Sale Studio"
        subtitle="Gestisci capienza massima standard e stato attivo delle sale"
      >
        <div className="space-y-5">
          <div className="space-y-2.5">
            {allRooms.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-[#E8E2D9] bg-[#FCFBF9] p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#23201D]">{r.name}</p>
                  {r.description && (
                    <p className="text-xs text-[#8E867B] truncate">{r.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[#625B52] flex items-center gap-1.5">
                    Capienza:
                    <input
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={r.default_capacity}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (val >= 1 && val !== r.default_capacity) {
                          handleUpdateRoom(r, { default_capacity: val });
                        }
                      }}
                      className="w-16 rounded-lg border border-[#DED6C8] bg-white px-2 py-1 text-xs font-semibold tabular-nums"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleUpdateRoom(r, { is_active: !r.is_active })}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                      r.is_active
                        ? 'bg-[#EAF4EE] text-[#2F6649]'
                        : 'bg-[#F1ECE3] text-[#8E867B]'
                    }`}
                  >
                    {r.is_active ? 'Attiva' : 'Sospesa'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <form
            onSubmit={handleAddRoom}
            className="rounded-xl border border-[#E8E2D9] bg-[#F8F6F2] p-4 space-y-3"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#625B52]">
              Aggiungi Nuova Sala
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                required
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Es. Sala 3 — Privé Cadillac"
                className="sm:col-span-2 rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={1}
                max={100}
                required
                value={roomCap}
                onChange={(e) => setRoomCap(Number(e.target.value))}
                placeholder="Capienza"
                className="rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <input
              type="text"
              value={roomDesc}
              onChange={(e) => setRoomDesc(e.target.value)}
              placeholder="Attrezzatura (opzionale)..."
              className="w-full rounded-xl border border-[#DED6C8] bg-white px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#4A6759] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3A5347]"
            >
              Crea Sala
            </button>
          </form>
        </div>
      </Modal>
    </div>
  );
}
