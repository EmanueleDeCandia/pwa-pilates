export type UserRole = 'ADMIN' | 'STAFF';

export type PaymentStatus = 'PAID' | 'UNPAID' | 'PARTIAL';
export type PackageStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';

export type AttendanceStatus =
  | 'PENDING'
  | 'PRESENT'
  | 'ABSENT_PENDING_DECISION'
  | 'ABSENT_DEDUCTED'
  | 'ABSENT_FROZEN'
  | 'RESCHEDULE_REQUESTED';

export interface AuthUser {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string;
  color: string;
  has_push_subscription: boolean;
  google_calendar_token: string | null;
}

export interface TeacherSummary {
  id: string;
  role: UserRole;
  full_name: string;
  email?: string;
  phone?: string;
  color: string;
  has_push_subscription?: boolean;
  monthly_validated_hours?: number;
  monthly_validated_lessons?: number;
  monthly_scheduled_hours?: number;
  pending_validations_count?: number;
  upcoming_tomorrow_count?: number;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  default_capacity: number;
  is_active: boolean;
}

export interface Student {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  medical_notes: string;
  is_archived?: boolean;
  archived_at?: string | null;
  created_at: string;
  active_package?: PackageWithStats | null;
  active_packages?: PackageWithStats[];
  current_consuming_package?: PackageWithStats | null;
  queued_packages?: PackageWithStats[];
  total_remaining_credits?: number;
  total_available_credits?: number;
  has_early_renewal?: boolean;
  packages_count?: number;
  total_unpaid_balance?: number;
}

export interface Package {
  id: string;
  student_id: string;
  student_first_name?: string;
  student_last_name?: string;
  student_phone?: string;
  name: string;
  total_credits: number;
  used_credits: number;
  frozen_credits: number;
  remaining_credits: number;
  booked_credits?: number;
  available_credits?: number;
  price: number;
  payment_status: PaymentStatus;
  amount_paid: number;
  balance_due: number;
  purchase_date: string;
  expiration_date: string | null;
  status: PackageStatus;
  is_consuming?: boolean;
  is_queued_renewal?: boolean;
}

export interface PackageWithStats extends Package {
  present_count: number;
  absent_deducted_count: number;
  absent_frozen_count: number;
  absent_pending_count: number;
  reschedule_requested_count: number;
  pending_bookings_count: number;
  total_absences: number;
}

/** Prenotazione vista lato STAFF (RLS: zero campi economici o pacchetto) */
export interface StaffBookingView {
  id: string;
  lesson_slot_id: string;
  student_id: string;
  student_first_name: string;
  student_last_name: string;
  student_medical_notes: string;
  attendance_status: AttendanceStatus;
  reschedule_note: string | null;
  updated_at: string;
}

/** Prenotazione completa vista lato ADMIN */
export interface AdminBookingView extends StaffBookingView {
  student_phone: string;
  package_id: string;
  package_name: string;
  package_total_credits: number;
  package_used_credits: number;
  package_remaining_credits: number;
  package_payment_status: PaymentStatus;
  rescheduled_to_slot_id: string | null;
}

export type TrafficLightStatus = 'GREEN' | 'YELLOW' | 'RED' | 'UPCOMING';

export interface LessonSlot {
  id: string;
  title: string;
  teacher_id: string;
  teacher_name: string;
  teacher_color: string;
  teacher_phone?: string;
  room_id: string;
  room_name: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  active_bookings_count: number;
  total_bookings_count: number;
  pending_students_count: number;
  present_count: number;
  absent_count: number;
  is_targeted: boolean;
  notes: string;
  series_id: string | null;
  is_validated: boolean;
  validated_at: string | null;
  validated_by: string | null;
  validated_by_name?: string | null;
  traffic_light: TrafficLightStatus;
}

export interface FreeSlotSuggestion {
  date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  available_rooms: Pick<Room, 'id' | 'name' | 'default_capacity'>[];
  available_teachers: { id: string; full_name: string; color: string }[];
}

export interface PublicCourseSlot {
  id: string;
  title: string;
  notes: string;
  room_name: string;
  teacher_first_name: string;
  teacher_color: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  remaining_spots: number;
}

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_role: UserRole;
  action_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AttendanceRegistryRecord {
  id: string;
  lesson_slot_id: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  duration_hours: number;
  lesson_title: string;
  is_targeted: boolean;
  is_validated: boolean;
  validated_at: string | null;
  room_id: string;
  room_name: string;
  teacher_id: string;
  teacher_name: string;
  teacher_color: string;
  teacher_phone: string | null;
  student_id: string;
  student_first_name: string;
  student_last_name: string;
  student_phone: string | null;
  attendance_status: AttendanceStatus;
  reschedule_note: string | null;
  rescheduled_to_slot_id?: string | null;
  rescheduled_to_title?: string | null;
  rescheduled_to_start_time?: string | null;
  package_id: string;
  package_name: string;
  package_price: number;
  package_amount_paid: number;
  package_balance_due: number;
  package_payment_status: PaymentStatus;
  package_total_credits: number;
  package_used_credits: number;
  package_remaining_credits: number;
  package_status: PackageStatus;
}

export interface ActionQueueItem {
  booking_id: string;
  lesson_slot_id: string;
  lesson_title: string;
  lesson_start_time: string;
  room_name: string;
  teacher_name: string;
  student_id: string;
  student_first_name: string;
  student_last_name: string;
  student_phone: string;
  package_id: string;
  package_name: string;
  package_remaining_credits: number;
  attendance_status: 'ABSENT_PENDING_DECISION' | 'RESCHEDULE_REQUESTED';
  reschedule_note: string | null;
  updated_at: string;
}

export interface OccupancyMatrixCell {
  day_of_week: number; // 1 = Lun ... 6 = Sab
  hour: number; // 8 ... 20
  booked_seats: number;
  total_capacity: number;
  slots_count: number;
  rooms_busy: number;
  total_rooms: number;
  room_utilization_pct: number;
  seat_occupancy_pct: number;
}

export interface RoomOccupancyStat {
  room_id: string;
  room_name: string;
  default_capacity: number;
  lessons_count: number;
  hours_used: number;
  available_hours: number;
  time_utilization_pct: number;
  total_seats_offered: number;
  total_seats_booked: number;
  seat_occupancy_pct: number;
}

export interface StudioSettings {
  studio_name: string;
  studio_subtitle: string;
  studio_city: string;
  owner_whatsapp: string;
  min_package_credits: number;
  max_package_credits: number;
  default_package_credits: number;
  renewal_alert_threshold: number;
}

export interface AdminDashboardData {
  today_lessons: LessonSlot[];
  absent_pending_queue: ActionQueueItem[];
  reschedule_queue: ActionQueueItem[];
  unpaid_packages: PackageWithStats[];
  low_credit_packages: PackageWithStats[];
  total_outstanding_amount: number;
  total_collected_amount: number;
  total_sales_amount: number;
  frequency_aggregate: {
    total_credits_sold: number;
    total_present: number;
    total_absences: number;
    total_absent_deducted: number;
    total_absent_frozen: number;
    total_absent_pending: number;
    total_remaining_credits: number;
    attendance_rate_pct: number;
  };
  package_analytics: PackageWithStats[];
  room_occupancy: RoomOccupancyStat[];
  occupancy_matrix: OccupancyMatrixCell[];
  occupancy_period: 'week' | 'month';
  teacher_hours: {
    teacher_id: string;
    full_name: string;
    color: string;
    phone: string;
    validated_hours_month: number;
    validated_lessons_month: number;
    scheduled_hours_month: number;
    unvalidated_past_lessons: number;
  }[];
  recent_audit_logs: AuditLogEntry[];
  unvalidated_past_total: number;
  db_info: {
    engine: string;
    file_path: string;
    file_size_bytes: number;
    counts: Record<string, number>;
  };
}

export interface PublicInquiry {
  id: string;
  lesson_slot_id: string | null;
  lesson_title: string | null;
  lesson_start_time: string | null;
  lesson_end_time: string | null;
  room_name: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  notes: string;
  status: 'NEW' | 'HANDLED';
  created_at: string;
}

export interface RealtimeEvent {
  type: 'SYNC' | 'PUSH_ALERT' | 'CONNECTED';
  entity?:
    | 'lessons'
    | 'bookings'
    | 'packages'
    | 'students'
    | 'rooms'
    | 'audit'
    | 'settings'
    | 'inquiries'
    | 'all';
  action?: string;
  message?: string;
  lesson_slot_id?: string;
  timestamp: string;
}
