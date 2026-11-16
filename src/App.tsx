import React, { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  Download,
  ExternalLink,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Users,
} from 'lucide-react';
import { BrandMark } from './components/BrandMark';
import { LessonDetailModal } from './components/LessonDetailModal';
import { ToastViewport, type ToastItem } from './components/Toast';
import { WhatsAppActionModal } from './components/WhatsAppActionModal';
import { LoginPage } from './pages/LoginPage';
import { PublicBoardPage } from './pages/PublicBoardPage';
import { StaffPortal } from './pages/staff/StaffPortal';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminCalendar } from './pages/admin/AdminCalendar';
import { AdminStudents } from './pages/admin/AdminStudents';
import { AdminTeachers } from './pages/admin/AdminTeachers';
import { AdminWhatsApp } from './pages/admin/AdminWhatsApp';
import { AdminAuditExport } from './pages/admin/AdminAuditExport';
import {
  apiFetch,
  registerWhatsAppModalListener,
  setStoredToken,
  type WhatsAppLaunchRequest,
} from './lib/api';
import { useRealtimeSync } from './lib/realtime';
import { isStandalonePwa, type BeforeInstallPromptEvent } from './lib/pwa';
import type {
  AuthUser,
  LessonSlot,
  PublicInquiry,
  RealtimeEvent,
  Room,
  TeacherSummary,
} from '../shared/types';

type AdminSection = 'dashboard' | 'calendar' | 'students' | 'teachers' | 'whatsapp' | 'audit';

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [showPublicBoard, setShowPublicBoard] = useState<boolean>(
    () => window.location.pathname === '/bacheca'
  );

  // Navigazione Titolare
  const [adminSection, setAdminSection] = useState<AdminSection>('dashboard');
  const [autoOpenFreeSlots, setAutoOpenFreeSlots] = useState(false);
  const [actionBadgeCount, setActionBadgeCount] = useState(0);
  const [newInquiriesCount, setNewInquiriesCount] = useState(0);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<TeacherSummary[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<LessonSlot | null>(null);

  // Real-time, WhatsApp composer & notifiche
  const [syncTick, setSyncTick] = useState(0);
  const [sessionSeq, setSessionSeq] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [waModalRequest, setWaModalRequest] = useState<WhatsAppLaunchRequest | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    registerWhatsAppModalListener((req) => setWaModalRequest(req));
    return () => registerWhatsAppModalListener(null);
  }, []);

  const notify = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4400);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Gestione navigazione /bacheca con History API
  useEffect(() => {
    const onPop = () => {
      setShowPublicBoard(window.location.pathname === '/bacheca');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigatePublicBoard = (open: boolean) => {
    const nextPath = open ? '/bacheca' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setShowPublicBoard(open);
  };

  // Intercetta evento installazione PWA nativa
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleTriggerInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const res = await installPrompt.userChoice;
    if (res.outcome === 'accepted') {
      notify('success', 'App installata sulla schermata Home.');
    }
    setInstallPrompt(null);
  };

  // Verifica Magic Link o sessione attiva all'avvio
  useEffect(() => {
    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      const magic = params.get('magic');
      if (magic) {
        try {
          const res = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/magic-verify', {
            method: 'POST',
            body: JSON.stringify({ token: magic }),
          });
          setStoredToken(res.token);
          setUser(res.user);
          window.history.replaceState({}, '', '/');
          notify('success', `Benvenuta, ${res.user.full_name.split(' ')[0]}!`);
          setBooting(false);
          return;
        } catch {
          window.history.replaceState({}, '', '/');
        }
      }

      try {
        const res = await apiFetch<{ user: AuthUser; token?: string }>('/api/auth/me');
        if (res.token) setStoredToken(res.token);
        setUser(res.user);
        setSessionSeq((s) => s + 1);
      } catch {
        setStoredToken(null);
        setUser(null);
      } finally {
        setBooting(false);
      }
    };
    init();
  }, [notify]);

  const loadAdminMeta = useCallback(async () => {
    if (!user || user.role !== 'ADMIN') return;
    try {
      const [rRes, tRes, inqRes] = await Promise.all([
        apiFetch<{ rooms: Room[] }>('/api/rooms?all=true'),
        apiFetch<{ teachers: TeacherSummary[] }>('/api/teachers'),
        apiFetch<{ inquiries: PublicInquiry[] }>('/api/inquiries?status=NEW'),
      ]);
      setRooms(rRes.rooms);
      setTeachers(tRes.teachers);
      setNewInquiriesCount(inqRes.inquiries.length);
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'Errore caricamento configurazione studio.'
      );
    }
  }, [user, notify]);

  useEffect(() => {
    loadAdminMeta();
  }, [loadAdminMeta]);

  // Aggiorna la lezione aperta nel modale quando cambia stato (es. sblocco/validazione)
  const refreshSelectedLesson = useCallback(async (lessonId: string) => {
    try {
      const res = await apiFetch<{ lessons: LessonSlot[] }>('/api/lessons');
      const found = res.lessons.find((l) => l.id === lessonId) || null;
      setSelectedLesson(found);
    } catch {
      // ignore
    }
  }, []);

  // Sottoscrizione WebSocket Real-Time (SRS 5)
  const handleRealtimeEvent = useCallback(
    (ev: RealtimeEvent) => {
      setSyncTick((t) => t + 1);
      if (ev.entity === 'rooms' || ev.entity === 'inquiries' || ev.entity === 'all') {
        loadAdminMeta();
      }
      if (ev.entity === 'inquiries' && ev.action === 'created' && ev.message) {
        notify('info', ev.message);
      }
      if (ev.type === 'PUSH_ALERT' && ev.message) {
        notify('info', ev.message);
      }
      if (selectedLesson && (!ev.lesson_slot_id || ev.lesson_slot_id === selectedLesson.id)) {
        refreshSelectedLesson(selectedLesson.id);
      }
    },
    [notify, selectedLesson, refreshSelectedLesson, loadAdminMeta]
  );

  const { connected: wsConnected } = useRealtimeSync(
    user ? `${user.id}:${sessionSeq}` : null,
    handleRealtimeEvent
  );

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setRooms([]);
    setTeachers([]);
    setActionBadgeCount(0);
    setNewInquiriesCount(0);
    setSelectedLesson(null);
  };

  if (showPublicBoard) {
    return (
      <>
        <PublicBoardPage
          isLoggedIn={Boolean(user)}
          onBackToApp={() => navigatePublicBoard(false)}
        />
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (booting) {
    return (
      <div className="min-h-dvh bg-[#F8F6F2] flex flex-col items-center justify-center gap-3">
        <BrandMark size={48} />
        <p className="font-display text-xl text-[#625B52]">Atelier Élan</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LoginPage
          onAuthenticated={(u) => {
            setUser(u);
            setSessionSeq((s) => s + 1);
            setAdminSection('dashboard');
          }}
          onOpenPublicBoard={() => navigatePublicBoard(true)}
        />
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  // INTERFACCIA DEDICATA MOBILE-FIRST PER INSEGNANTI (STAFF — SRS 4.3)
  if (user.role === 'STAFF') {
    return (
      <>
        <StaffPortal
          user={user}
          onUserUpdated={setUser}
          onLogout={handleLogout}
          wsConnected={wsConnected}
          syncTick={syncTick}
          installPrompt={installPrompt}
          onTriggerInstall={handleTriggerInstall}
          notify={notify}
        />
        <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  // INTERFACCIA COMPLETA TITOLARE (ADMIN)
  const navItems: {
    id: AdminSection;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard & KPI',
      shortLabel: 'Home',
      icon: LayoutDashboard,
      badge: actionBadgeCount,
    },
    {
      id: 'calendar',
      label: 'Calendario & Sale',
      shortLabel: 'Calendario',
      icon: Calendar,
    },
    {
      id: 'students',
      label: 'Studenti & Pacchetti',
      shortLabel: 'Studenti',
      icon: Users,
    },
    {
      id: 'teachers',
      label: 'Insegnanti',
      shortLabel: 'Staff',
      icon: GraduationCap,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      shortLabel: 'WhatsApp',
      icon: MessageCircle,
      badge: newInquiriesCount,
    },
    {
      id: 'audit',
      label: 'Audit, Export & DB',
      shortLabel: 'Registro',
      icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="min-h-dvh bg-[#F8F6F2] flex flex-col lg:flex-row">
      {/* Sidebar Desktop Titolare */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:justify-between border-r border-[#E8E2D9] bg-[#F4F0E8]/85 px-4 py-6 sticky top-0 h-dvh">
        <div className="space-y-7">
          <div className="flex items-center gap-3 px-2">
            <BrandMark size={40} />
            <div>
              <p className="font-display text-2xl font-semibold text-[#23201D] leading-none">
                Atelier Élan
              </p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-[#8E867B] mt-1">
                Pilates &amp; Danza
              </p>
            </div>
          </div>

          <nav aria-label="Menu principale Titolare" className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = adminSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setAdminSection(item.id)}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                    active
                      ? 'bg-[#4A6759] text-white shadow-xs'
                      : 'text-[#625B52] hover:bg-white/80 hover:text-[#23201D]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                        active ? 'bg-white/20 text-white' : 'bg-[#FBECEB] text-[#A63A31]'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="px-1 space-y-2">
            <button
              type="button"
              onClick={() => navigatePublicBoard(true)}
              className="w-full flex items-center justify-between rounded-xl border border-[#E2DACD] bg-white/80 px-3.5 py-2 text-xs font-medium text-[#625B52] hover:text-[#23201D] hover:bg-white transition-colors"
            >
              <span>Bacheca Pubblica</span>
              <ExternalLink className="h-3.5 w-3.5 text-[#4A6759]" />
            </button>

            {!isStandalonePwa() && installPrompt && (
              <button
                type="button"
                onClick={handleTriggerInstall}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-[#23201D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3A3530]"
              >
                <Download className="h-3.5 w-3.5" />
                Installa App PWA
              </button>
            )}
          </div>
        </div>

        {/* Footer stato Real-Time + DB Locale + Profilo Titolare */}
        <div className="space-y-3 pt-4 border-t border-[#E5DEC9]">
          <div className="flex items-center justify-between px-2 text-[11px] text-[#625B52]">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  wsConnected ? 'bg-[#3D7A5A]' : 'bg-[#C4862D]'
                }`}
              />
              {wsConnected ? 'Real-Time attivo' : 'Riconnessione...'}
            </span>
            <span className="font-medium text-[#4A6759]">DB Locale</span>
          </div>

          <div className="rounded-xl bg-white border border-[#E8E2D9] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#23201D] truncate">{user.full_name}</p>
              <p className="text-[10px] text-[#8E867B]">Titolare · Admin</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Disconnetti"
              className="rounded-lg p-1.5 text-[#8E867B] hover:bg-[#F4F0E8] hover:text-[#23201D]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Header Mobile/Tablet Titolare */}
      <header className="lg:hidden sticky top-0 z-30 border-b border-[#E8E2D9] bg-white/92 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BrandMark size={34} />
          <div>
            <p className="font-display text-lg font-semibold text-[#23201D] leading-none">
              Atelier Élan
            </p>
            <p className="text-[10px] text-[#625B52] flex items-center gap-1 mt-0.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  wsConnected ? 'bg-[#3D7A5A]' : 'bg-[#C4862D]'
                }`}
              />
              {user.full_name} · DB Locale
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-1 rounded-xl border border-[#E2DACD] px-2.5 py-1.5 text-xs font-medium text-[#625B52]"
        >
          <LogOut className="h-3.5 w-3.5" />
          Esci
        </button>
      </header>

      {/* Contenuto Principale */}
      <main className="flex-1 min-w-0 px-4 sm:px-7 lg:px-10 py-6 lg:py-8 pb-24 lg:pb-10">
        <div className="max-w-6xl mx-auto">
          {adminSection === 'dashboard' && (
            <AdminDashboard
              onSelectLesson={setSelectedLesson}
              onNavigate={setAdminSection}
              onOpenFreeSlotsFinder={() => {
                setAutoOpenFreeSlots(true);
                setAdminSection('calendar');
              }}
              notify={notify}
              syncTick={syncTick}
              onActionCountChange={setActionBadgeCount}
            />
          )}

          {adminSection === 'calendar' && (
            <AdminCalendar
              rooms={rooms}
              teachers={teachers}
              onSelectLesson={setSelectedLesson}
              onMetaChanged={loadAdminMeta}
              onOpenPublicBoard={() => navigatePublicBoard(true)}
              notify={notify}
              syncTick={syncTick}
              autoOpenFreeSlots={autoOpenFreeSlots}
              onConsumedAutoFreeSlots={() => setAutoOpenFreeSlots(false)}
            />
          )}

          {adminSection === 'students' && <AdminStudents notify={notify} syncTick={syncTick} />}

          {adminSection === 'teachers' && (
            <AdminTeachers
              teachers={teachers}
              onMetaChanged={loadAdminMeta}
              onSelectLesson={setSelectedLesson}
              notify={notify}
              syncTick={syncTick}
            />
          )}

          {adminSection === 'whatsapp' && (
            <AdminWhatsApp
              onOpenPublicBoard={() => navigatePublicBoard(true)}
              onInquiriesChanged={loadAdminMeta}
              notify={notify}
              syncTick={syncTick}
            />
          )}

          {adminSection === 'audit' && (
            <AdminAuditExport
              user={user}
              teachers={teachers}
              onUserReplaced={(u) => {
                setUser(u);
                setSessionSeq((s) => s + 1);
              }}
              onGlobalReset={() => {
                setSyncTick((t) => t + 1);
                loadAdminMeta();
              }}
              notify={notify}
              syncTick={syncTick}
            />
          )}
        </div>
      </main>

      {/* Bottom Navigation Mobile/Tablet Titolare */}
      <nav
        aria-label="Navigazione mobile Titolare"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[#E8E2D9] bg-white/95 backdrop-blur-md safe-bottom"
      >
        <div className="grid grid-cols-6 px-1 pt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = adminSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setAdminSection(item.id)}
                className={`relative flex flex-col items-center gap-0.5 py-1 text-[10px] font-medium ${
                  active ? 'text-[#4A6759]' : 'text-[#8E867B]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate max-w-full px-0.5">{item.shortLabel}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute top-0 right-2 h-3.5 min-w-3.5 rounded-full bg-[#B5443A] px-1 text-[9px] font-bold text-white flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modale Dettaglio Lezione, Assegnazione Studenti, Sblocco Appello */}
      <LessonDetailModal
        lesson={selectedLesson}
        rooms={rooms}
        teachers={teachers}
        onClose={() => setSelectedLesson(null)}
        onChanged={() => {
          setSyncTick((t) => t + 1);
          if (selectedLesson) refreshSelectedLesson(selectedLesson.id);
        }}
        notify={notify}
        syncTick={syncTick}
      />

      <WhatsAppActionModal
        request={waModalRequest}
        onClose={() => setWaModalRequest(null)}
        notify={notify}
      />

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
