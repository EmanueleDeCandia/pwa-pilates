import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { WebSocket } from 'ws';
import { createDatabase, setDbForTesting } from '../db.js';
import { seedDatabase, DEMO_ACCOUNTS } from '../seed.js';
import { createApiRouter } from '../routes.js';
import { attachRealtimeServer } from '../realtime.js';
import { initVapidKeys } from '../push.js';

async function runTests(): Promise<void> {
  // Usa DB SQLite in memoria isolato per non alterare il DB locale dell'app
  const db = createDatabase(':memory:');
  setDbForTesting(db);
  seedDatabase(db, { force: true });
  initVapidKeys();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', createApiRouter());

  const server = http.createServer(app);
  attachRealtimeServer(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;

  const api = async (
    path: string,
    opts: { method?: string; token?: string; body?: unknown } = {}
  ) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  };

  let passed = 0;
  const check = (name: string, cond: unknown) => {
    assert.ok(cond, `FALLITO: ${name}`);
    passed++;
    console.log(`  ✓ ${name}`);
  };

  try {
    console.log('\n[1] Autenticazione (Email+Password e Magic Link Staff — SRS 1)');
    const adminLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: DEMO_ACCOUNTS.admin.email, password: DEMO_ACCOUNTS.admin.password },
    });
    check('Login Titolare (ADMIN) con email+password', adminLogin.status === 200 && adminLogin.json.user.role === 'ADMIN');
    const adminToken: string = adminLogin.json.token;

    const giuliaLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: DEMO_ACCOUNTS.teacher1.email, password: DEMO_ACCOUNTS.teacher1.password },
    });
    check('Login Insegnante 1 (STAFF) con email+password', giuliaLogin.status === 200 && giuliaLogin.json.user.role === 'STAFF');
    const giuliaToken: string = giuliaLogin.json.token;
    const giuliaUser = giuliaLogin.json.user;

    const magicReq = await api('/api/auth/magic-link', {
      method: 'POST',
      body: { email: DEMO_ACCOUNTS.teacher2.email },
    });
    const magicTok = new URL(magicReq.json.magic_path, base).searchParams.get('magic');
    const camillaLogin = await api('/api/auth/magic-verify', {
      method: 'POST',
      body: { token: magicTok },
    });
    check('Login Insegnante 2 (STAFF) tramite Magic Link monouso', camillaLogin.status === 200 && camillaLogin.json.user.role === 'STAFF');
    const camillaToken: string = camillaLogin.json.token;
    const camillaUser = camillaLogin.json.user;

    console.log('\n[2] Sicurezza Row-Level Security (Isolamento dati economici STAFF — SRS 1 & 5)');
    check('STAFF bloccato su GET /api/packages (403)', (await api('/api/packages', { token: giuliaToken })).status === 403);
    check('STAFF bloccato su GET /api/students (403)', (await api('/api/students', { token: giuliaToken })).status === 403);
    check('STAFF bloccato su GET /api/audit-logs (403)', (await api('/api/audit-logs', { token: giuliaToken })).status === 403);
    check('STAFF bloccato su GET /api/dashboard/admin (403)', (await api('/api/dashboard/admin', { token: giuliaToken })).status === 403);
    check('STAFF bloccato su GET /api/export/revenue.csv (403)', (await api('/api/export/revenue.csv', { token: giuliaToken })).status === 403);

    const staffSummary = await api('/api/staff/summary', { token: giuliaToken });
    check('STAFF vede banner lezioni passate non validate', staffSummary.json.unvalidated_past_lessons.length >= 1);
    const giuliaOpenSlot = staffSummary.json.unvalidated_past_lessons[0];

    const staffBookings = await api(`/api/lessons/${giuliaOpenSlot.id}/bookings`, { token: giuliaToken });
    check('STAFF legge lista iscritti e note posturali del proprio corso', staffBookings.status === 200 && staffBookings.json.bookings.length > 0);
    const sampleBooking = staffBookings.json.bookings[0];
    check(
      'Vista RLS STAFF esclude totalmente package_id, prezzi, crediti, pagamento e telefono',
      sampleBooking.package_id === undefined &&
        sampleBooking.price === undefined &&
        sampleBooking.payment_status === undefined &&
        sampleBooking.package_remaining_credits === undefined &&
        sampleBooking.student_phone === undefined &&
        typeof sampleBooking.student_medical_notes === 'string'
    );
    check(
      'STAFF bloccato su iscrizioni di un corso assegnato ad altra docente (403)',
      (await api(`/api/lessons/${giuliaOpenSlot.id}/bookings`, { token: camillaToken })).status === 403
    );

    console.log('\n[3] Vincoli Hard Conflitto Sala, Conflitto Docente e Capienza (SRS 3.1)');
    const roomsRes = await api('/api/rooms', { token: adminToken });
    const [room1, room2] = roomsRes.json.rooms;

    const testDay = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
    const createSlot1 = await api('/api/lessons', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Test Reformer Duo',
        room_id: room1.id,
        teacher_id: giuliaUser.id,
        start_time: `${testDay}T10:00:00.000Z`,
        end_time: `${testDay}T11:00:00.000Z`,
        max_capacity: 2,
      },
    });
    check('Creazione lezione valida (capienza=2)', createSlot1.status === 201);
    const testSlotId: string = createSlot1.json.lessons[0].id;

    const roomConflict = await api('/api/lessons', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Corso Sovrapposto Stessa Sala',
        room_id: room1.id,
        teacher_id: camillaUser.id,
        start_time: `${testDay}T10:30:00.000Z`,
        end_time: `${testDay}T11:30:00.000Z`,
      },
    });
    check('Blocco hard Conflitto Sala (409 ROOM_CONFLICT)', roomConflict.status === 409 && roomConflict.json.code === 'ROOM_CONFLICT');

    const teacherConflict = await api('/api/lessons', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Corso Sovrapposto Stessa Docente',
        room_id: room2.id,
        teacher_id: giuliaUser.id,
        start_time: `${testDay}T10:15:00.000Z`,
        end_time: `${testDay}T11:15:00.000Z`,
      },
    });
    check('Blocco hard Conflitto Docente (409 TEACHER_CONFLICT)', teacherConflict.status === 409 && teacherConflict.json.code === 'TEACHER_CONFLICT');

    const adjacentSlot = await api('/api/lessons', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Corso Consecutivo [11:00, 12:00)',
        room_id: room1.id,
        teacher_id: giuliaUser.id,
        start_time: `${testDay}T11:00:00.000Z`,
        end_time: `${testDay}T12:00:00.000Z`,
        max_capacity: 4,
      },
    });
    check('Intervalli contigui [10:00,11:00) e [11:00,12:00) consentiti', adjacentSlot.status === 201);
    const recoverySlotId: string = adjacentSlot.json.lessons[0].id;

    // Crea 3 studenti freschi con pacchetti da 10 lezioni per testare capienza e crediti al centesimo
    const testStudents: { id: string; pkgId: string }[] = [];
    for (let i = 1; i <= 3; i++) {
      const st = await api('/api/students', {
        method: 'POST',
        token: adminToken,
        body: {
          first_name: `Allieva${i}`,
          last_name: 'Test',
          phone: `+39340999000${i}`,
          medical_notes: 'Postura controllata',
        },
      });
      const pk = await api('/api/packages', {
        method: 'POST',
        token: adminToken,
        body: {
          student_id: st.json.student.id,
          name: 'Pacchetto 10 Test',
          total_credits: 10,
          price: 200,
          payment_status: 'PAID',
        },
      });
      testStudents.push({ id: st.json.student.id, pkgId: pk.json.package.id });
    }

    // Test Real-Time WebSocket mentre la Titolare aggiunge studenti!
    console.log('\n[4] Real-Time Sync WebSocket & Macchina a Stati Crediti (SRS 3.2 & 5)');
    const staffWsEvents: any[] = [];
    const staffWs = new WebSocket(`ws://127.0.0.1:${addr.port}/ws?token=${giuliaToken}`);
    await new Promise<void>((resolve) => staffWs.on('open', resolve));
    staffWs.on('message', (d) => staffWsEvents.push(JSON.parse(String(d))));

    const b1Res = await api(`/api/lessons/${testSlotId}/bookings`, {
      method: 'POST',
      token: adminToken,
      body: { student_id: testStudents[0].id },
    });
    const b2Res = await api(`/api/lessons/${testSlotId}/bookings`, {
      method: 'POST',
      token: adminToken,
      body: { student_id: testStudents[1].id },
    });
    check('Assegnazione 2/2 studenti in stato PENDING', b1Res.status === 201 && b2Res.status === 201);

    await new Promise((r) => setTimeout(r, 80));
    check(
      'Insegnante riceve notifica WebSocket Real-Time istantanea su aggiunta studente',
      staffWsEvents.some((e) => e.type === 'SYNC' && e.entity === 'bookings' && e.lesson_slot_id === testSlotId)
    );

    const capOverflow = await api(`/api/lessons/${testSlotId}/bookings`, {
      method: 'POST',
      token: adminToken,
      body: { student_id: testStudents[2].id },
    });
    check('Blocco hard Capienza Massima (409 CAPACITY_EXCEEDED)', capOverflow.status === 409 && capOverflow.json.code === 'CAPACITY_EXCEEDED');

    // Verifica 0 crediti scalati alla prenotazione
    const getPkg = async (pkgId: string) => {
      const r = await api('/api/packages', { token: adminToken });
      return r.json.packages.find((p: any) => p.id === pkgId);
    };
    check('Nessun credito scalato alla prenotazione (used=0)', (await getPkg(testStudents[0].pkgId)).used_credits === 0);

    // Chiusura appello bloccata finché esistono PENDING
    const prematureVal = await api(`/api/lessons/${testSlotId}/validate`, {
      method: 'POST',
      token: giuliaToken,
    });
    check('Blocco chiusura appello con studenti ancora PENDING (400)', prematureVal.status === 400);

    // Docente segna Presente su s1 -> used_credits = 1
    await api(`/api/bookings/${b1Res.json.booking_id}/attendance`, {
      method: 'PATCH',
      token: giuliaToken,
      body: { attendance_status: 'PRESENT' },
    });
    check('Presente scala immediatamente 1 credito (used=1, rem=9)', (await getPkg(testStudents[0].pkgId)).used_credits === 1);

    // Docente segna Assente su s2 -> ABSENT_PENDING_DECISION, used_credits = 0
    await api(`/api/bookings/${b2Res.json.booking_id}/attendance`, {
      method: 'PATCH',
      token: giuliaToken,
      body: { attendance_status: 'ABSENT_PENDING_DECISION' },
    });
    check('Assente non scala subito il credito (used=0, coda Titolare)', (await getPkg(testStudents[1].pkgId)).used_credits === 0);

    // Docente non può scalare/congelare discrezionalmente
    const forbiddenDeduct = await api(`/api/bookings/${b2Res.json.booking_id}/attendance`, {
      method: 'PATCH',
      token: giuliaToken,
      body: { attendance_status: 'ABSENT_DEDUCTED' },
    });
    check('STAFF non può scegliere ABSENT_DEDUCTED (403)', forbiddenDeduct.status === 403);

    // Docente chiude appello
    const closeVal = await api(`/api/lessons/${testSlotId}/validate`, {
      method: 'POST',
      token: giuliaToken,
    });
    check('Docente conferma e chiude appello (is_validated=true)', closeVal.status === 200);

    // Docente bloccata dopo chiusura
    const lockedEdit = await api(`/api/bookings/${b1Res.json.booking_id}/attendance`, {
      method: 'PATCH',
      token: giuliaToken,
      body: { attendance_status: 'ABSENT_PENDING_DECISION' },
    });
    check('Appello chiuso diventa sola lettura per il docente (403 LESSON_LOCKED)', lockedEdit.status === 403);
    check('STAFF non può sbloccare appello (403)', (await api(`/api/lessons/${testSlotId}/unlock`, { method: 'POST', token: giuliaToken })).status === 403);

    // Titolare congela assenza di s2 -> frozen_credits = 1, used_credits = 0
    await api(`/api/bookings/${b2Res.json.booking_id}/attendance`, {
      method: 'PATCH',
      token: adminToken,
      body: { attendance_status: 'ABSENT_FROZEN' },
    });
    const pkg2AfterFreeze = await getPkg(testStudents[1].pkgId);
    check('Titolare congela assenza -> frozen_credits=1, remaining=10', pkg2AfterFreeze.frozen_credits === 1 && pkg2AfterFreeze.remaining_credits === 10);

    // Titolare riprogramma s2 nello slot successivo
    const resched = await api(`/api/bookings/${b2Res.json.booking_id}/reschedule`, {
      method: 'POST',
      token: adminToken,
      body: { target_lesson_slot_id: recoverySlotId },
    });
    check('Titolare riprogramma lezione congelata su nuovo slot', resched.status === 200);

    // Titolare sblocca appello -> docente può correggere e i crediti si riallineano senza drift!
    const unlockRes = await api(`/api/lessons/${testSlotId}/unlock`, {
      method: 'POST',
      token: adminToken,
    });
    check('Titolare sblocca appello (200)', unlockRes.status === 200);

    const fixAfterUnlock = await api(`/api/bookings/${b1Res.json.booking_id}/attendance`, {
      method: 'PATCH',
      token: giuliaToken,
      body: { attendance_status: 'RESCHEDULE_REQUESTED', reschedule_note: 'Errore materiale corretto' },
    });
    check(
      'Rettifica docente dopo sblocco ripristina esattamente il credito (used=0)',
      fixAfterUnlock.status === 200 && (await getPkg(testStudents[0].pkgId)).used_credits === 0
    );

    // Verifica che un evento economico su packages NON arrivi mai al WebSocket STAFF
    const prevLen = staffWsEvents.length;
    await api(`/api/packages/${testStudents[0].pkgId}`, {
      method: 'PATCH',
      token: adminToken,
      body: { payment_status: 'PARTIAL', amount_paid: 100 },
    });
    await new Promise((r) => setTimeout(r, 80));
    check('Eventi economici packages filtrati su WebSocket STAFF (RLS real-time)', staffWsEvents.length === prevLen);
    staffWs.close();

    console.log('\n[5] Slot Liberi, Bacheca Pubblica, Feed Google Calendar .ics & Export CSV/Excel (SRS 4 & 5)');
    const today = new Date().toISOString().slice(0, 10);
    const weekAhead = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    const freeRes = await api(
      `/api/lessons/free-slots?startDate=${today}&endDate=${weekAhead}&windowStart=14:00&windowEnd=18:00&minDuration=60`,
      { token: adminToken }
    );
    check('Algoritmo Slot Liberi rileva le finestre pomeridiane disponibili', freeRes.status === 200 && freeRes.json.free_slots.length >= 2);

    const pubRes = await api('/api/public/availability');
    check('Bacheca Pubblica accessibile senza login con corsi mirati e posti residui', pubRes.status === 200 && pubRes.json.courses.length >= 3);

    const icsRes = await api(`/api/calendar/${giuliaUser.google_calendar_token}/feed.ics`);
    check(
      'Feed Google Calendar .ics contiene VALARM nativi -60m e +15m fine lezione',
      icsRes.status === 200 &&
        icsRes.text.includes('BEGIN:VCALENDAR') &&
        icsRes.text.includes('TRIGGER:-PT60M') &&
        icsRes.text.includes('TRIGGER;RELATED=END:PT15M')
    );

    const dashRes = await api('/api/dashboard/admin?period=week', { token: adminToken });
    check(
      'Dashboard Titolare restituisce tutti e 6 i moduli KPI + matrice occupazione + monte ore',
      dashRes.status === 200 &&
        dashRes.json.today_lessons.length >= 4 &&
        dashRes.json.teacher_hours.length === 2 &&
        dashRes.json.occupancy_matrix.length === 6 * 13 &&
        dashRes.json.recent_audit_logs.length > 0
    );

    const xlsRes = await api('/api/export/contabilita.xls', { token: adminToken });
    const csvRes = await api('/api/export/packages.csv', { token: adminToken });
    check(
      'Esportazioni contabili CSV (UTF-8 BOM) e Excel multi-foglio funzionanti',
      xlsRes.status === 200 &&
        xlsRes.text.includes('Worksheet ss:Name="Registro Incassi"') &&
        csvRes.status === 200 &&
        csvRes.text.includes('Lezioni Totali;Lezioni Usate;Lezioni Congelate')
    );

    console.log('\n[6] Resilienza Auth Iframe/Proxy, CRUD Sale/Staff e Richiesta Posto Bacheca Pubblica');
    // Simula iframe HTTPS cross-site con reverse proxy che sovrascrive Authorization e cookie stantio
    const httpsLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({
        email: DEMO_ACCOUNTS.admin.email,
        password: DEMO_ACCOUNTS.admin.password,
      }),
    });
    const setCookieHeader = httpsLogin.headers.get('set-cookie') || '';
    check(
      'Cookie sessione HTTPS compatibile con iframe cross-site (SameSite=None; Secure; Partitioned)',
      setCookieHeader.includes('SameSite=None') &&
        setCookieHeader.includes('Secure') &&
        setCookieHeader.includes('Partitioned')
    );

    const proxyResilientRes = await fetch(`${base}/api/rooms?all=true`, {
      headers: {
        'X-Elan-Token': adminToken,
        Authorization: 'Bearer token-iniettato-dal-proxy-non-valido',
        Cookie: 'elan_session=vecchio-cookie-scaduto',
      },
    });
    const proxyRooms = await proxyResilientRes.json();
    check(
      'Header X-Elan-Token autentica correttamente anche con proxy Authorization/cookie alterati',
      proxyResilientRes.status === 200 && proxyRooms.rooms.length >= 2
    );

    const newRoomRes = await api('/api/rooms', {
      method: 'POST',
      token: adminToken,
      body: { name: 'Sala 3 — Studio Privato Cadillac', description: 'Lezioni individuali', default_capacity: 2 },
    });
    check('Configurazione Sale Studio: creazione nuova sala (201)', newRoomRes.status === 201);

    const newTeacherRes = await api('/api/teachers', {
      method: 'POST',
      token: adminToken,
      body: {
        full_name: 'Sara Marchetti',
        email: 'sara.marchetti@atelierpilates.it',
        phone: '+393478899112',
        color: '#6E6582',
      },
    });
    check('Sezione Staff: creazione nuovo insegnante (201)', newTeacherRes.status === 201);

    const targetCourseId = pubRes.json.courses.find((c: any) => c.remaining_spots > 0).id;
    const pubInqRes = await api('/api/public/inquiries', {
      method: 'POST',
      body: {
        lesson_slot_id: targetCourseId,
        first_name: 'Francesca',
        last_name: 'Lombardi',
        phone: '3401122334',
        notes: 'Prima prova Reformer',
      },
    });
    check('Bacheca Pubblica "Richiedi Posto" zero-login registra la richiesta (201)', pubInqRes.status === 201);
    check('STAFF bloccato su GET /api/inquiries (403 RLS)', (await api('/api/inquiries', { token: giuliaToken })).status === 403);

    const inqList = await api('/api/inquiries?status=NEW', { token: adminToken });
    check('Titolare visualizza la nuova richiesta dalla Bacheca Pubblica', inqList.status === 200 && inqList.json.inquiries.length === 1);

    const enrollInq = await api(`/api/inquiries/${pubInqRes.json.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'HANDLED', enroll: true },
    });
    check('Titolare iscrive in 1 clic il richiedente al Corso Mirato (200)', enrollInq.status === 200);

    const camillaSummary = await api('/api/staff/summary', { token: camillaToken });
    check(
      'Account Insegnante 2 (Camilla) carica correttamente i propri turni assegnati',
      camillaSummary.status === 200 &&
        (camillaSummary.json.today_lessons.length > 0 ||
          camillaSummary.json.unvalidated_past_lessons.length > 0)
    );

    // [7] Verifica Rinnovo Anticipato Pacchetti (Presentazione lezioni rimanenti)
    const stdsBefore = await api('/api/students', { token: adminToken });
    const studentToRenew = stdsBefore.json.students.find(
      (s: any) => s.active_package && s.active_package.remaining_credits > 0
    );
    const prevRemaining = studentToRenew.active_package.remaining_credits;

    // Emette un rinnovo anticipato prima di terminare le lezioni disponibili
    const renewPkgRes = await api('/api/packages', {
      method: 'POST',
      token: adminToken,
      body: {
        student_id: studentToRenew.id,
        name: 'Rinnovo Pacchetto 10 Lezioni Pilates',
        total_credits: 10,
        price: 180,
        payment_status: 'PAID',
        amount_paid: 180,
      },
    });
    check('Emissione rinnovo anticipato pacchetto registrata con successo (201)', renewPkgRes.status === 201);

    const stdsRes = await api('/api/students', { token: adminToken });
    const earlyStudent = stdsRes.json.students.find((s: any) => s.id === studentToRenew.id);
    check(
      'Anagrafica Studenti rileva rinnovo anticipato con lezioni residue cumulate (has_early_renewal & total_remaining_credits)',
      earlyStudent &&
        earlyStudent.has_early_renewal === true &&
        earlyStudent.total_remaining_credits === prevRemaining + 10 &&
        earlyStudent.current_consuming_package.id === studentToRenew.active_package.id &&
        earlyStudent.queued_packages.length === 1
    );

    const pkgsListRes = await api('/api/packages', { token: adminToken });
    const hasConsuming = pkgsListRes.json.packages.some(
      (p: any) => p.student_id === studentToRenew.id && p.is_consuming === true
    );
    const hasQueued = pkgsListRes.json.packages.some(
      (p: any) => p.student_id === studentToRenew.id && p.is_queued_renewal === true
    );
    check(
      'Registro Pacchetti distingue pacchetto in consumo FIFO e rinnovo in coda',
      hasConsuming && hasQueued
    );

    console.log(`\nTutte le ${passed} verifiche SRS superate con successo!\n`);
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
