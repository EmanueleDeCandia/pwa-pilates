import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { recordAuditLog, runInTransaction } from './db.js';

export const DEMO_ACCOUNTS = {
  admin: {
    email: 'elena.rossi@atelierpilates.it',
    password: 'Admin2026!',
    full_name: 'Elena Rossi',
    role: 'ADMIN' as const,
    phone: '+393471122334',
    color: '#4A6759',
  },
  teacher1: {
    email: 'giulia.ferretti@atelierpilates.it',
    password: 'Staff2026!',
    full_name: 'Giulia Ferretti',
    role: 'STAFF' as const,
    phone: '+393382233445',
    color: '#4A6759', // Verde Salvia / Eucalipto
  },
  teacher2: {
    email: 'camilla.conti@atelierpilates.it',
    password: 'Staff2026!',
    full_name: 'Camilla Conti',
    role: 'STAFF' as const,
    phone: '+393394455667',
    color: '#B86B52', // Terracotta / Argilla
  },
};

function makeDateAt(baseDate: Date, dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate() + dayOffset,
      hour,
      minute,
      0,
      0
    )
  );
  return d.toISOString();
}

function makeIsoDate(baseDate: Date, dayOffset: number): string {
  const d = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + dayOffset)
  );
  return d.toISOString().slice(0, 10);
}

export function isDatabaseSeeded(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count > 0;
}

export function seedDatabase(db: DatabaseSync, options: { force?: boolean } = {}): void {
  if (!options.force && isDatabaseSeeded(db)) {
    return;
  }

  const now = new Date();
  const adminHash = bcrypt.hashSync(DEMO_ACCOUNTS.admin.password, 10);
  const staffHash = bcrypt.hashSync(DEMO_ACCOUNTS.teacher1.password, 10);

  runInTransaction(db, () => {
    // Pulizia ordinata rispettando le foreign key
    db.exec(`
      DELETE FROM sent_notifications;
      DELETE FROM magic_links;
      DELETE FROM audit_logs;
      DELETE FROM bookings;
      DELETE FROM lesson_slots;
      DELETE FROM packages;
      DELETE FROM students;
      DELETE FROM rooms;
      DELETE FROM users;
      DELETE FROM studio_settings;
    `);

    // Impostazioni Studio
    db.prepare(
      `INSERT INTO studio_settings
        (id, studio_name, studio_subtitle, studio_city, owner_whatsapp, min_package_credits, max_package_credits, default_package_credits, renewal_alert_threshold)
       VALUES (1, 'Atelier Élan', 'Studio Pilates & Danza Sportiva', 'Ancona', ?, 1, 30, 10, 2)`
    ).run(DEMO_ACCOUNTS.admin.phone);

    // 2.1 Utenti (1 Titolare + 2 Insegnanti)
    const adminId = crypto.randomUUID();
    const giuliaId = crypto.randomUUID();
    const camillaId = crypto.randomUUID();

    const insertUser = db.prepare(
      `INSERT INTO users (id, role, full_name, email, password_hash, phone, color, google_calendar_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertUser.run(
      adminId,
      'ADMIN',
      DEMO_ACCOUNTS.admin.full_name,
      DEMO_ACCOUNTS.admin.email,
      adminHash,
      DEMO_ACCOUNTS.admin.phone,
      DEMO_ACCOUNTS.admin.color,
      `cal_admin_${crypto.randomBytes(16).toString('hex')}`
    );
    insertUser.run(
      giuliaId,
      'STAFF',
      DEMO_ACCOUNTS.teacher1.full_name,
      DEMO_ACCOUNTS.teacher1.email,
      staffHash,
      DEMO_ACCOUNTS.teacher1.phone,
      DEMO_ACCOUNTS.teacher1.color,
      `cal_giulia_${crypto.randomBytes(16).toString('hex')}`
    );
    insertUser.run(
      camillaId,
      'STAFF',
      DEMO_ACCOUNTS.teacher2.full_name,
      DEMO_ACCOUNTS.teacher2.email,
      staffHash,
      DEMO_ACCOUNTS.teacher2.phone,
      DEMO_ACCOUNTS.teacher2.color,
      `cal_camilla_${crypto.randomBytes(16).toString('hex')}`
    );

    // 2.2 Sale
    const salaReformerId = crypto.randomUUID();
    const salaMatworkId = crypto.randomUUID();

    const insertRoom = db.prepare(
      `INSERT INTO rooms (id, name, description, default_capacity, is_active) VALUES (?, ?, ?, ?, 1)`
    );
    insertRoom.run(
      salaReformerId,
      'Sala 1 — Reformer',
      '6 Reformer Balanced Body in acero, Cadillac Tower e Stability Chair',
      6
    );
    insertRoom.run(
      salaMatworkId,
      'Sala 2 — Matwork',
      'Parquet ammortizzato, sbarre in rovere, Magic Circle, Foam Roller e Fitball',
      10
    );

    // 2.3 Studenti (12 allievi realistici con note posturali utili ai docenti)
    const studentDefs = [
      {
        first: 'Sofia',
        last: 'Marchetti',
        phone: '+393401182930',
        notes: 'Ernia discale L4-L5 stabilizzata: evitare roll-up completo e flessioni caricate.',
      },
      {
        first: 'Martina',
        last: 'Bellini',
        phone: '+393492273841',
        notes: 'Cervicalgia tensiva ricorrente: utilizzare cuscinetto occipitale negli esercizi supini.',
      },
      {
        first: 'Chiara',
        last: 'Lombardi',
        phone: '+393334491028',
        notes: 'Gravidanza II trimestre (22ª sett.): evitare posizione supina prolungata, usare cuneo.',
      },
      {
        first: 'Alessandro',
        last: 'Rinaldi',
        phone: '+393485502917',
        notes: 'Recupero post-artroscopia spalla destra: limitare flessione overhead oltre 120°.',
      },
      {
        first: 'Beatrice',
        last: 'Moretti',
        phone: '+393356613826',
        notes: 'Iperlordosi lombare: focus su imprinting pelvico e controllo trasverso addominale.',
      },
      {
        first: 'Francesca',
        last: 'Galli',
        phone: '+393477724935',
        notes: '',
      },
      {
        first: 'Lorenzo',
        last: 'Santini',
        phone: '+393388835044',
        notes: 'Rigidità catena posteriore e ischiocrurali corti: usare blocchetti yoga nelle sedute.',
      },
      {
        first: 'Valentina',
        last: 'De Angelis',
        phone: '+393429946153',
        notes: 'Scoliosi dorso-lombare lieve: privilegiare allungamento assiale e lavoro simmetrico.',
      },
      {
        first: 'Aurora',
        last: 'Pellegrini',
        phone: '+393312057262',
        notes: 'Ex ballerina danza sportiva — ottima mobilità, curare stabilità articolare anca sx.',
      },
      {
        first: 'Giorgia',
        last: 'Mancini',
        phone: '+393463168371',
        notes: 'Diastasi addominale lieve post-parto: evitare crunch diretti e plank prolungati.',
      },
      {
        first: 'Matteo',
        last: 'Mariani',
        phone: '+393394279480',
        notes: '',
      },
      {
        first: 'Elisa',
        last: 'Vitale',
        phone: '+393455380599',
        notes: 'Sensibilità ai polsi in quadrupedia: proporre appoggio su avambracci o maniglie.',
      },
    ];

    const insertStudent = db.prepare(
      `INSERT INTO students (id, first_name, last_name, phone, medical_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const students = studentDefs.map((s, idx) => {
      const id = crypto.randomUUID();
      insertStudent.run(id, s.first, s.last, s.phone, s.notes, makeDateAt(now, -45 + idx * 2, 10, 0));
      return { id, ...s };
    });

    // 2.4 Pacchetti Lezioni (inizialmente used_credits = 0, calcolati esattamente dalle prenotazioni!)
    const pkgDefs = [
      { s: 0, name: 'Pacchetto 10 Lezioni Reformer', total: 10, price: 260, statusPay: 'PAID', paid: 260, buyOff: -40, expOff: 50 },
      { s: 1, name: 'Pacchetto 10 Lezioni Posturale', total: 10, price: 180, statusPay: 'PAID', paid: 180, buyOff: -38, expOff: 52 },
      { s: 2, name: 'Pacchetto 8 Lezioni Pre-Parto', total: 8, price: 220, statusPay: 'PARTIAL', paid: 120, buyOff: -25, expOff: 65 },
      { s: 3, name: 'Pacchetto 10 Lezioni Reformer', total: 10, price: 260, statusPay: 'UNPAID', paid: 0, buyOff: -18, expOff: 72 },
      { s: 4, name: 'Pacchetto 10 Lezioni Matwork', total: 10, price: 160, statusPay: 'PAID', paid: 160, buyOff: -42, expOff: 48 },
      { s: 5, name: 'Pacchetto 12 Lezioni Danza Pilates', total: 12, price: 210, statusPay: 'PAID', paid: 210, buyOff: -30, expOff: 60 },
      { s: 6, name: 'Pacchetto 5 Lezioni Intro Reformer', total: 5, price: 145, statusPay: 'PAID', paid: 145, buyOff: -35, expOff: 25 },
      { s: 7, name: 'Pacchetto 10 Lezioni Posturale', total: 10, price: 180, statusPay: 'PARTIAL', paid: 90, buyOff: -22, expOff: 68 },
      { s: 8, name: 'Pacchetto 10 Lezioni Reformer & Sbarra', total: 10, price: 240, statusPay: 'PAID', paid: 240, buyOff: -28, expOff: 62 },
      { s: 9, name: 'Pacchetto 10 Lezioni Matwork Dolce', total: 10, price: 170, statusPay: 'UNPAID', paid: 0, buyOff: -12, expOff: 78 },
      { s: 10, name: 'Pacchetto 10 Lezioni Matwork', total: 10, price: 160, statusPay: 'PAID', paid: 160, buyOff: -20, expOff: 70 },
      { s: 11, name: 'Pacchetto 6 Lezioni Reformer Duo', total: 6, price: 195, statusPay: 'PAID', paid: 195, buyOff: -32, expOff: 14 },
    ];

    const insertPkg = db.prepare(
      `INSERT INTO packages
        (id, student_id, name, total_credits, used_credits, frozen_credits, price, payment_status, amount_paid, purchase_date, expiration_date, status)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 'ACTIVE')`
    );

    const packages = pkgDefs.map((p) => {
      const id = crypto.randomUUID();
      insertPkg.run(
        id,
        students[p.s].id,
        p.name,
        p.total,
        p.price,
        p.statusPay,
        p.paid,
        makeIsoDate(now, p.buyOff),
        makeIsoDate(now, p.expOff)
      );
      return { id, ...p, used: 0, frozen: 0 };
    });

    const insertSlot = db.prepare(
      `INSERT INTO lesson_slots
        (id, title, teacher_id, room_id, start_time, end_time, max_capacity, is_targeted, notes, series_id, is_validated, validated_at, validated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertBooking = db.prepare(
      `INSERT INTO bookings
        (id, lesson_slot_id, student_id, package_id, attendance_status, reschedule_note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    function addBookingWithCredits(
      slotId: string,
      studentIdx: number,
      status:
        | 'PENDING'
        | 'PRESENT'
        | 'ABSENT_PENDING_DECISION'
        | 'ABSENT_DEDUCTED'
        | 'ABSENT_FROZEN'
        | 'RESCHEDULE_REQUESTED',
      updatedAt: string,
      note: string | null = null
    ): string {
      const pkg = packages[studentIdx];
      if ((status === 'PRESENT' || status === 'ABSENT_DEDUCTED') && pkg.used >= pkg.total) {
        return '';
      }
      const bId = crypto.randomUUID();
      insertBooking.run(bId, slotId, students[studentIdx].id, pkg.id, status, note, updatedAt);
      if (status === 'PRESENT' || status === 'ABSENT_DEDUCTED') {
        pkg.used += 1;
        const newStatus = pkg.used >= pkg.total ? 'EXHAUSTED' : 'ACTIVE';
        db.prepare('UPDATE packages SET used_credits = ?, status = ? WHERE id = ?').run(
          pkg.used,
          newStatus,
          pkg.id
        );
      } else if (status === 'ABSENT_FROZEN') {
        pkg.frozen += 1;
        db.prepare('UPDATE packages SET frozen_credits = ? WHERE id = ?').run(pkg.frozen, pkg.id);
      }
      return bId;
    }

    function createLesson(opts: {
      title: string;
      teacher: string;
      room: string;
      dayOff: number;
      startH: number;
      startM?: number;
      durMin?: number;
      cap?: number;
      targeted?: boolean;
      notes?: string;
      validated?: boolean;
      validatedDelayMin?: number;
      seriesId?: string | null;
      attendees: {
        s: number;
        status:
          | 'PENDING'
          | 'PRESENT'
          | 'ABSENT_PENDING_DECISION'
          | 'ABSENT_DEDUCTED'
          | 'ABSENT_FROZEN'
          | 'RESCHEDULE_REQUESTED';
        note?: string;
      }[];
    }): string {
      const id = crypto.randomUUID();
      const startM = opts.startM ?? 0;
      const durMin = opts.durMin ?? 60;
      const startIso = makeDateAt(now, opts.dayOff, opts.startH, startM);
      const endDate = new Date(new Date(startIso).getTime() + durMin * 60_000);
      const endIso = endDate.toISOString();
      const cap = opts.cap ?? (opts.room === salaReformerId ? 6 : 10);
      const validated = opts.validated ? 1 : 0;
      const validatedAt = opts.validated
        ? new Date(endDate.getTime() + (opts.validatedDelayMin ?? 8) * 60_000).toISOString()
        : null;
      const validatedBy = opts.validated ? opts.teacher : null;

      insertSlot.run(
        id,
        opts.title,
        opts.teacher,
        opts.room,
        startIso,
        endIso,
        cap,
        opts.targeted ? 1 : 0,
        opts.notes ?? '',
        opts.seriesId ?? null,
        validated,
        validatedAt,
        validatedBy
      );

      const bTime = validatedAt ?? startIso;
      let presentCount = 0;
      let absentCount = 0;
      for (const att of opts.attendees) {
        const bId = addBookingWithCredits(id, att.s, att.status, bTime, att.note ?? null);
        if (att.status === 'PRESENT') presentCount++;
        else if (att.status !== 'PENDING') absentCount++;

        if (bId && att.status === 'ABSENT_DEDUCTED') {
          recordAuditLog(
            db,
            adminId,
            'CREDIT_DEDUCTED',
            bId,
            {
              student_name: `${students[att.s].first} ${students[att.s].last}`,
              lesson_title: opts.title,
              previous_status: 'ABSENT_PENDING_DECISION',
              new_status: 'ABSENT_DEDUCTED',
            },
            new Date(endDate.getTime() + 45 * 60_000).toISOString()
          );
        } else if (bId && att.status === 'ABSENT_FROZEN') {
          recordAuditLog(
            db,
            adminId,
            'CREDIT_FROZEN',
            bId,
            {
              student_name: `${students[att.s].first} ${students[att.s].last}`,
              lesson_title: opts.title,
              previous_status: 'ABSENT_PENDING_DECISION',
              new_status: 'ABSENT_FROZEN',
            },
            new Date(endDate.getTime() + 50 * 60_000).toISOString()
          );
        } else if (bId && att.status === 'RESCHEDULE_REQUESTED') {
          recordAuditLog(
            db,
            opts.teacher,
            'RESCHEDULE_REQUESTED',
            bId,
            {
              student_name: `${students[att.s].first} ${students[att.s].last}`,
              lesson_title: opts.title,
              note: att.note ?? '',
            },
            bTime
          );
        }
      }

      if (opts.validated && validatedAt) {
        recordAuditLog(
          db,
          opts.teacher,
          'ATTENDANCE_VALIDATED',
          id,
          {
            lesson_title: opts.title,
            room_name: opts.room === salaReformerId ? 'Sala 1 — Reformer' : 'Sala 2 — Matwork',
            present_count: presentCount,
            absent_count: absentCount,
            lesson_start: startIso,
          },
          validatedAt
        );
      }

      return id;
    }

    const seriesReformerMattina = crypto.randomUUID();
    const seriesMatworkFlow = crypto.randomUUID();
    const seriesPosturale = crypto.randomUUID();
    const seriesSbarra = crypto.randomUUID();

    // =========================================================================
    // STORICO LEZIONI VALIDATE (ultime 3 settimane) — costruisce analitica realistica
    // Sofia (s:0) raggiunge 8 presenze + 1 scalata + 1 congelata -> 1 credito residuo!
    // Lorenzo (s:6, pacchetto 5) raggiunge 5 usati -> 0 crediti residui (EXHAUSTED)!
    // Elisa (s:11, pacchetto 6) raggiunge 4 usati -> 2 crediti residui (Alert rinnovo)!
    // Martina (s:1, pacchetto 10) raggiunge 8 usati -> 2 crediti residui (Alert rinnovo)!
    // =========================================================================
    const pastOffsets = [-19, -17, -14, -12, -10, -7, -5, -3];
    pastOffsets.forEach((dayOff, i) => {
      createLesson({
        title: 'Pilates Reformer Essenziale',
        teacher: giuliaId,
        room: salaReformerId,
        dayOff,
        startH: 9,
        validated: true,
        validatedDelayMin: 6 + (i % 7),
        seriesId: seriesReformerMattina,
        attendees: [
          {
            s: 0,
            status: i === 3 ? 'ABSENT_DEDUCTED' : i === 6 ? 'ABSENT_FROZEN' : 'PRESENT',
          },
          { s: 1, status: i === 5 ? 'ABSENT_FROZEN' : 'PRESENT' },
          ...(i < 5 ? [{ s: 6, status: 'PRESENT' as const }] : []),
          ...(i >= 3 ? [{ s: 11, status: i === 4 ? 'ABSENT_FROZEN' as const : 'PRESENT' as const }] : []),
          ...(i >= 4 ? [{ s: 3, status: 'PRESENT' as const }] : []),
          ...(i >= 2 ? [{ s: 8, status: i === 7 ? 'ABSENT_DEDUCTED' as const : 'PRESENT' as const }] : []),
        ],
      });

      createLesson({
        title: 'Pilates Matwork & Respiro',
        teacher: camillaId,
        room: salaMatworkId,
        dayOff,
        startH: 9,
        startM: 30,
        validated: true,
        validatedDelayMin: 5 + (i % 9),
        seriesId: seriesMatworkFlow,
        attendees: [
          { s: 4, status: i === 2 ? 'ABSENT_DEDUCTED' : 'PRESENT' },
          { s: 5, status: 'PRESENT' },
          ...(i >= 3 ? [{ s: 7, status: i === 6 ? 'ABSENT_FROZEN' as const : 'PRESENT' as const }] : []),
          ...(i >= 4 ? [{ s: 10, status: 'PRESENT' as const }] : []),
          ...(i >= 5 ? [{ s: 9, status: 'PRESENT' as const }] : []),
          ...(i >= 4 ? [{ s: 2, status: 'PRESENT' as const }] : []),
        ],
      });
    });

    // Lezione di ieri per Giulia non convalidata (garantisce unvalidated_past_lessons a qualsiasi ora UTC)
    createLesson({
      title: 'Pilates Reformer Base & Postura',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: -1,
      startH: 17,
      startM: 0,
      validated: false,
      seriesId: seriesPosturale,
      notes: 'Focus allungamento catena posteriore con Box.',
      attendees: [
        { s: 1, status: 'PENDING' },
        { s: 3, status: 'PENDING' },
      ],
    });

    // Lezione di 2 giorni fa (con assenze da decidere e spostamenti in coda per la Titolare!)
    createLesson({
      title: 'Pilates Posturale & Colonna',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: -2,
      startH: 18,
      validated: true,
      validatedDelayMin: 11,
      seriesId: seriesPosturale,
      attendees: [
        { s: 0, status: 'PRESENT' }, // Sofia: 7 presenze + 1 scalata = 8 usati, poi oggi +1 = 9 usati (1 residuo!)
        { s: 1, status: 'PRESENT' }, // Martina: 8 usati (2 residui!)
        { s: 3, status: 'ABSENT_PENDING_DECISION' }, // In Coda Azioni Titolare!
        {
          s: 2,
          status: 'RESCHEDULE_REQUESTED',
          note: 'Visita ostetrica di controllo, chiede recupero giovedì mattina.',
        }, // In Coda Spostamenti Titolare!
      ],
    });

    createLesson({
      title: 'Sbarra & Danza Pilates',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: -2,
      startH: 18,
      startM: 30,
      validated: true,
      validatedDelayMin: 9,
      seriesId: seriesSbarra,
      attendees: [
        { s: 5, status: 'PRESENT' },
        { s: 8, status: 'PRESENT' },
        { s: 9, status: 'ABSENT_PENDING_DECISION' }, // Seconda assenza in Coda Azioni Titolare!
        {
          s: 7,
          status: 'RESCHEDULE_REQUESTED',
          note: 'Imprevisto lavorativo in trasferta, preferisce recuperare venerdì.',
        }, // Seconda richiesta di spostamento!
        { s: 10, status: 'PRESENT' },
      ],
    });

    // =========================================================================
    // OGGI (dayOff = 0): Semaforo completo Verde / Rosso / Giallo-In Programma
    // NOTA: Fascia pomeridiana 14:00 - 18:00 LIBERA per dimostrare l'algoritmo Slot Liberi!
    // =========================================================================
    // 1. Mattina — VALIDATA (Verde)
    createLesson({
      title: 'Pilates Reformer Essenziale',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 0,
      startH: 8,
      startM: 30,
      validated: true,
      validatedDelayMin: 7,
      seriesId: seriesReformerMattina,
      attendees: [
        { s: 0, status: 'PRESENT' }, // Sofia ora ha 8 presenze + 1 scalata + 1 congelata -> 9/10 usati (1 residuo!)
        { s: 3, status: 'PRESENT' },
        { s: 8, status: 'PRESENT' },
        { s: 11, status: 'ABSENT_PENDING_DECISION' }, // Fresca di oggi nella Coda Azioni!
      ],
    });

    // 2. Mattina — VALIDATA (Verde)
    createLesson({
      title: 'Pilates Matwork & Respiro',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 0,
      startH: 9,
      startM: 0,
      validated: true,
      validatedDelayMin: 5,
      seriesId: seriesMatworkFlow,
      attendees: [
        { s: 4, status: 'PRESENT' }, // Beatrice: 9/10 usati (1 residuo!)
        { s: 5, status: 'PRESENT' },
        { s: 9, status: 'PRESENT' },
        { s: 10, status: 'PRESENT' },
      ],
    });

    // 3. Tarda Mattina — NON VALIDATA (Rosso per Titolare + Banner Anti-Dimenticanza per Giulia!)
    createLesson({
      title: 'Pilates Posturale Reformer',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 0,
      startH: 10,
      startM: 30,
      validated: false,
      seriesId: seriesPosturale,
      notes: 'Focus mobilità toracica e scarico lombare con Reformer Box.',
      attendees: [
        { s: 1, status: 'PENDING' },
        { s: 2, status: 'PENDING' },
        { s: 7, status: 'PENDING' },
        { s: 11, status: 'PENDING' },
      ],
    });

    // 4. Pausa Pranzo — NON VALIDATA (Rosso per Titolare + Banner Anti-Dimenticanza per Camilla!)
    createLesson({
      title: 'Sbarra & Danza Pilates',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 0,
      startH: 12,
      startM: 30,
      validated: false,
      seriesId: seriesSbarra,
      notes: 'Sequenza fluida alla sbarra con piccoli attrezzi e Magic Circle.',
      attendees: [
        { s: 5, status: 'PENDING' },
        { s: 8, status: 'PENDING' },
        { s: 9, status: 'PENDING' },
        { s: 10, status: 'PENDING' },
      ],
    });

    // 5. Sera — Lezione serale oggi (Giallo se in corso alle 19:xx, Verde/Rosso/In programma in base all'ora)
    createLesson({
      title: 'Reformer Control & Core',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 0,
      startH: 19,
      startM: 0,
      validated: false,
      notes: 'Livello intermedio — controllo del powerhouse e serie Long Stretch.',
      attendees: [
        { s: 0, status: 'PENDING' },
        { s: 3, status: 'PENDING' },
        { s: 8, status: 'PENDING' },
        { s: 11, status: 'PENDING' },
        { s: 1, status: 'PENDING' },
      ],
    });

    createLesson({
      title: 'Pilates Sera Distensivo',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 0,
      startH: 20,
      startM: 15,
      validated: false,
      notes: 'Decompressione vertebrale, stretching miofasciale e respirazione diaframmatica.',
      attendees: [
        { s: 4, status: 'PENDING' },
        { s: 7, status: 'PENDING' },
        { s: 9, status: 'PENDING' },
        { s: 10, status: 'PENDING' },
      ],
    });

    // =========================================================================
    // DOMANI (dayOff = 1): Perfetto per Promemoria WhatsApp 1-Click a studenti e docenti!
    // =========================================================================
    createLesson({
      title: 'Pilates Reformer Mattina',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 1,
      startH: 9,
      startM: 30,
      notes: 'Allineamento scapolare e lavoro con Footbar.',
      attendees: [
        { s: 1, status: 'PENDING' },
        { s: 3, status: 'PENDING' },
        { s: 8, status: 'PENDING' },
        { s: 11, status: 'PENDING' },
      ],
    });

    createLesson({
      title: 'Corso Mirato — Pilates in Gravidanza',
      teacher: giuliaId,
      room: salaMatworkId,
      dayOff: 1,
      startH: 15,
      startM: 0,
      cap: 6,
      targeted: true,
      notes: 'Piccolo gruppo dedicato a respiro, pavimento pelvico e mobilità dolce del bacino.',
      attendees: [
        { s: 2, status: 'PENDING' },
        { s: 9, status: 'PENDING' },
      ],
    });

    createLesson({
      title: 'Matwork Dinamico & Magic Circle',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 1,
      startH: 18,
      startM: 0,
      attendees: [
        { s: 5, status: 'PENDING' },
        { s: 7, status: 'PENDING' },
        { s: 9, status: 'PENDING' },
        { s: 10, status: 'PENDING' },
      ],
    });

    // =========================================================================
    // RESTO DELLA SETTIMANA (dayOff = 2..5)
    // Pomeriggi 14:00-18:00 lasciati liberi su dayOff 0, 2, 4 per il filtro "Mostra Disponibilità"!
    // =========================================================================
    // dayOff = 2 (Mercoledì se oggi è Lunedì): mattina + sera, pomeriggio 14-18 completamente libero!
    createLesson({
      title: 'Pilates Reformer Essenziale',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 2,
      startH: 9,
      seriesId: seriesReformerMattina,
      attendees: [
        { s: 3, status: 'PENDING' },
        { s: 8, status: 'PENDING' },
        { s: 11, status: 'PENDING' },
      ],
    });
    createLesson({
      title: 'Pilates Matwork & Respiro',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 2,
      startH: 10,
      seriesId: seriesMatworkFlow,
      attendees: [
        { s: 5, status: 'PENDING' },
        { s: 7, status: 'PENDING' },
        { s: 10, status: 'PENDING' },
      ],
    });
    createLesson({
      title: 'Pilates Posturale Sera',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 2,
      startH: 18,
      startM: 30,
      seriesId: seriesPosturale,
      attendees: [
        { s: 1, status: 'PENDING' },
        { s: 3, status: 'PENDING' },
      ],
    });

    // dayOff = 3 (Giovedì): con Corso Mirato Pomeridiano pubblicato in Bacheca Pubblica
    createLesson({
      title: 'Reformer Armonia & Postura',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 3,
      startH: 10,
      attendees: [
        { s: 1, status: 'PENDING' },
        { s: 3, status: 'PENDING' },
      ],
    });
    createLesson({
      title: 'Corso Mirato — Schiena Sana & Postura',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 3,
      startH: 15,
      startM: 30,
      cap: 6,
      targeted: true,
      notes: 'Percorso specialistico su Reformer per decompressione lombare, cervicalgia e postura da ufficio.',
      attendees: [
        { s: 1, status: 'PENDING' },
        { s: 7, status: 'PENDING' },
        { s: 3, status: 'PENDING' },
      ],
    });
    createLesson({
      title: 'Sbarra & Danza Pilates',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 3,
      startH: 18,
      startM: 30,
      seriesId: seriesSbarra,
      attendees: [
        { s: 5, status: 'PENDING' },
        { s: 8, status: 'PENDING' },
        { s: 10, status: 'PENDING' },
      ],
    });

    // dayOff = 4 (Venerdì): mattina + sera, pomeriggio 14-18 libero!
    createLesson({
      title: 'Pilates Reformer Flow',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 4,
      startH: 9,
      startM: 30,
      attendees: [
        { s: 3, status: 'PENDING' },
        { s: 8, status: 'PENDING' },
      ],
    });
    createLesson({
      title: 'Matwork & Flessibilità',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 4,
      startH: 18,
      startM: 0,
      attendees: [
        { s: 5, status: 'PENDING' },
        { s: 9, status: 'PENDING' },
        { s: 10, status: 'PENDING' },
      ],
    });

    // dayOff = 5 (Sabato mattina): Corso Mirato Sbarra & Reformer
    createLesson({
      title: 'Corso Mirato — Sbarra & Port de Bras',
      teacher: camillaId,
      room: salaMatworkId,
      dayOff: 5,
      startH: 10,
      startM: 0,
      durMin: 75,
      cap: 8,
      targeted: true,
      notes: 'Fusione tra tecnica Pilates, allungamento danza sportiva e grazia del movimento alla sbarra.',
      attendees: [
        { s: 5, status: 'PENDING' },
        { s: 8, status: 'PENDING' },
        { s: 10, status: 'PENDING' },
      ],
    });
    createLesson({
      title: 'Corso Mirato — Reformer Power Atelier',
      teacher: giuliaId,
      room: salaReformerId,
      dayOff: 6,
      startH: 15,
      startM: 0,
      cap: 5,
      targeted: true,
      notes: 'Small group avanzato su Reformer e Stability Chair per forza profonda e controllo.',
      attendees: [
        { s: 8, status: 'PENDING' },
        { s: 3, status: 'PENDING' },
      ],
    });

    // Un log storico di sblocco appello per mostrare anche LESSON_UNLOCKED nell'Audit Log
    recordAuditLog(
      db,
      adminId,
      'LESSON_UNLOCKED',
      seriesReformerMattina,
      {
        lesson_title: 'Pilates Reformer Essenziale',
        reason: 'Correzione presenza segnalata da Giulia Ferretti',
      },
      makeDateAt(now, -4, 11, 20)
    );
  });
}

export interface CleanSlateOptions {
  adminEmail?: string;
  adminPassword?: string;
  adminFullName?: string;
  adminPhone?: string;
  studioName?: string;
  studioSubtitle?: string;
  studioCity?: string;
  ownerWhatsapp?: string;
}

/**
 * Resetta il database allo stato "Clean Slate" (Tabula Rasa):
 * Elimina tutti gli allievi, lezioni, prenotazioni, pacchetti e audit log.
 * Mantiene (o ricrea) l'account della Titolare e le Sale base, pronto per la gestione reale dello studio.
 */
export function cleanSlateDatabase(db: DatabaseSync, options: CleanSlateOptions = {}): { adminUser: typeof DEMO_ACCOUNTS.admin & { id: string } } {
  const adminEmail = options.adminEmail?.trim().toLowerCase() || DEMO_ACCOUNTS.admin.email;
  const adminPassword = options.adminPassword || DEMO_ACCOUNTS.admin.password;
  const adminFullName = options.adminFullName?.trim() || DEMO_ACCOUNTS.admin.full_name;
  const adminPhone = options.adminPhone?.trim() || DEMO_ACCOUNTS.admin.phone;
  const studioName = options.studioName?.trim() || 'Atelier Élan';
  const studioSubtitle = options.studioSubtitle?.trim() || 'Studio Pilates & Danza Sportiva';
  const studioCity = options.studioCity?.trim() || 'Ancona';
  const ownerWhatsapp = options.ownerWhatsapp?.trim() || adminPhone;

  const adminHash = bcrypt.hashSync(adminPassword, 10);
  const adminId = crypto.randomUUID();

  runInTransaction(db, () => {
    db.exec(`
      DELETE FROM sent_notifications;
      DELETE FROM magic_links;
      DELETE FROM audit_logs;
      DELETE FROM bookings;
      DELETE FROM lesson_slots;
      DELETE FROM packages;
      DELETE FROM students;
      DELETE FROM rooms;
      DELETE FROM users;
      DELETE FROM studio_settings;
    `);

    // Impostazioni Studio
    db.prepare(
      `INSERT INTO studio_settings
        (id, studio_name, studio_subtitle, studio_city, owner_whatsapp, min_package_credits, max_package_credits, default_package_credits, renewal_alert_threshold)
       VALUES (1, ?, ?, ?, ?, 1, 30, 10, 2)`
    ).run(studioName, studioSubtitle, studioCity, ownerWhatsapp);

    // Utente Titolare (ADMIN)
    db.prepare(
      `INSERT INTO users (id, role, full_name, email, password_hash, phone, color, google_calendar_token)
       VALUES (?, 'ADMIN', ?, ?, ?, ?, '#4A6759', ?)`
    ).run(adminId, adminFullName, adminEmail, adminHash, adminPhone, `cal_admin_${crypto.randomBytes(16).toString('hex')}`);

    // Sale base dello studio (Reformer e Matwork)
    const insertRoom = db.prepare(
      `INSERT INTO rooms (id, name, description, default_capacity, is_active) VALUES (?, ?, ?, ?, 1)`
    );
    insertRoom.run(
      crypto.randomUUID(),
      'Sala 1 — Reformer',
      'Reformer Balanced Body, Cadillac Tower e Stability Chair',
      6
    );
    insertRoom.run(
      crypto.randomUUID(),
      'Sala 2 — Matwork',
      'Parquet ammortizzato, sbarre in rovere, Magic Circle, Foam Roller e Fitball',
      10
    );

    recordAuditLog(db, adminId, 'SYSTEM_INIT_CLEAN', adminId, {
      description: 'Database inizializzato in modalità Clean Slate (pronto per produzione)',
      studio: studioName,
      admin: adminEmail,
    });
  });

  return {
    adminUser: {
      id: adminId,
      email: adminEmail,
      password: adminPassword,
      full_name: adminFullName,
      role: 'ADMIN',
      phone: adminPhone,
      color: '#4A6759',
    },
  };
}
