-- ============================================================================
-- ATELIER ÉLAN — SCHEMA DI PRODUZIONE POSTGRESQL / SUPABASE (CON RLS)
-- Specifica Tecnica dei Requisiti Software (SRS) — Sezioni 2, 3 e 5
-- In pre-produzione l'app utilizza SQLite locale (data/pilates.sqlite) con gli
-- stessi vincoli hard, trigger e isolamento RLS per ruolo STAFF.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE TYPE user_role AS ENUM ('ADMIN', 'STAFF');
CREATE TYPE payment_status AS ENUM ('PAID', 'UNPAID', 'PARTIAL');
CREATE TYPE package_status AS ENUM ('ACTIVE', 'EXHAUSTED', 'EXPIRED');
CREATE TYPE attendance_status AS ENUM (
  'PENDING',
  'PRESENT',
  'ABSENT_PENDING_DECISION',
  'ABSENT_DEDUCTED',
  'ABSENT_FROZEN',
  'RESCHEDULE_REQUESTED'
);

-- 2.1 users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  color TEXT NOT NULL DEFAULT '#4A6759',
  push_subscription JSONB,
  google_calendar_token TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.2 rooms
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_capacity INTEGER NOT NULL CHECK (default_capacity >= 1),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- 2.3 students
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  medical_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.4 packages
CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_credits INTEGER NOT NULL DEFAULT 10 CHECK (total_credits >= 1),
  used_credits INTEGER NOT NULL DEFAULT 0 CHECK (used_credits >= 0 AND used_credits <= total_credits),
  frozen_credits INTEGER NOT NULL DEFAULT 0 CHECK (frozen_credits >= 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  payment_status payment_status NOT NULL,
  amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiration_date DATE,
  status package_status NOT NULL DEFAULT 'ACTIVE'
);

-- 2.5 lesson_slots (con vincoli EXCLUDE USING gist per conflitto sala e docente — SRS 3.1)
CREATE TABLE lesson_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  max_capacity INTEGER NOT NULL CHECK (max_capacity >= 1),
  is_targeted BOOLEAN NOT NULL DEFAULT false,
  notes TEXT NOT NULL DEFAULT '',
  series_id UUID,
  is_validated BOOLEAN NOT NULL DEFAULT false,
  validated_at TIMESTAMPTZ,
  validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CHECK (end_time > start_time),
  CONSTRAINT no_room_overlap EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ),
  CONSTRAINT no_teacher_overlap EXCLUDE USING gist (
    teacher_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  )
);

-- 2.6 bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_slot_id UUID NOT NULL REFERENCES lesson_slots(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  attendance_status attendance_status NOT NULL DEFAULT 'PENDING',
  reschedule_note TEXT,
  rescheduled_to_slot_id UUID REFERENCES lesson_slots(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lesson_slot_id, student_id)
);

-- 2.7 audit_logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2.8 public_inquiries (Richieste posto zero-login dalla Bacheca Pubblica — SRS 4.1)
CREATE TABLE public_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_slot_id UUID REFERENCES lesson_slots(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'HANDLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vista isolata per ruolo STAFF: esclude strutturalmente package_id, prezzi, crediti, pagamenti e telefono
CREATE VIEW staff_bookings_rls_view AS
SELECT
  b.id,
  b.lesson_slot_id,
  ls.teacher_id AS assigned_teacher_id,
  b.student_id,
  s.first_name AS student_first_name,
  s.last_name AS student_last_name,
  s.medical_notes AS student_medical_notes,
  b.attendance_status,
  b.reschedule_note,
  b.updated_at
FROM bookings b
JOIN students s ON s.id = b.student_id
JOIN lesson_slots ls ON ls.id = b.lesson_slot_id;

-- ============================================================================
-- 5. ROW-LEVEL SECURITY (RLS) — Isolamento rigoroso ADMIN vs STAFF
-- ============================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_inquiries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- packages: NESSUNA policy SELECT/UPDATE per STAFF -> zero visibilità economica
CREATE POLICY admin_all_packages ON packages
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- audit_logs: lettura riservata esclusivamente alla Titolare (ADMIN)
CREATE POLICY admin_read_audit ON audit_logs
  FOR SELECT USING (is_admin());

-- rooms: lettura consentita a tutti gli autenticati, scrittura solo ADMIN
CREATE POLICY read_rooms_authenticated ON rooms
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY admin_manage_rooms ON rooms
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- lesson_slots: STAFF vede tutte le sale per coordinamento; valida solo i propri slot aperti
CREATE POLICY read_slots_authenticated ON lesson_slots
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY admin_manage_slots ON lesson_slots
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_validate_own_slots ON lesson_slots
  FOR UPDATE USING (teacher_id = auth.uid() AND is_validated = false)
  WITH CHECK (teacher_id = auth.uid());

-- bookings: STAFF vede e aggiorna solo le iscrizioni dei propri corsi non ancora chiusi
CREATE POLICY admin_manage_bookings ON bookings
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read_own_bookings ON bookings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lesson_slots ls
      WHERE ls.id = bookings.lesson_slot_id AND ls.teacher_id = auth.uid()
    )
  );
CREATE POLICY staff_mark_attendance ON bookings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM lesson_slots ls
      WHERE ls.id = bookings.lesson_slot_id
        AND ls.teacher_id = auth.uid()
        AND ls.is_validated = false
    )
  );

-- students: ADMIN accesso completo; STAFF vede solo studenti iscritti ai propri corsi
CREATE POLICY admin_manage_students ON students
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY staff_read_assigned_students ON students
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN lesson_slots ls ON ls.id = b.lesson_slot_id
      WHERE b.student_id = students.id AND ls.teacher_id = auth.uid()
    )
  );

-- public_inquiries: inserimento pubblico zero-login dalla bacheca; lettura/gestione esclusiva ADMIN
CREATE POLICY public_submit_inquiry ON public_inquiries
  FOR INSERT WITH CHECK (status = 'NEW');
CREATE POLICY admin_manage_inquiries ON public_inquiries
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Abilitazione Supabase Realtime per sincronizzazione istantanea appelli e richieste bacheca
ALTER PUBLICATION supabase_realtime ADD TABLE lesson_slots, bookings, packages, public_inquiries;
