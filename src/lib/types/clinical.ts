export type MedFrequencyType =
  | "FIXED_HOURS"
  | "DAILY_SLOTS"
  | "INTERVAL_DAYS"
  | "INTERVAL_WEEKS";

export type IntakeConstraint =
  | "NONE"
  | "FASTING"
  | "WITH_FOOD"
  | "SEPARATE_FROM_OTHERS";

export type IntakeStatus = "PENDING" | "TAKEN" | "DELAYED" | "SKIPPED";

export type EventCategory =
  | "APPOINTMENT"
  | "INJECTION"
  | "LAB_TEST"
  | "PROCEDURE"
  | "OTHER";

export type TaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "WAITING_RESPONSE"
  | "COMPLETED";

export type AlertStage =
  | "7_DAYS_BEFORE"
  | "3_DAYS_BEFORE"
  | "1_DAY_BEFORE"
  | "DAY_OF"
  | "EXACT_TIME"
  | "LOW_STOCK_7D";

export type AlertStatus = "QUEUED" | "SENT" | "ACKNOWLEDGED" | "SNOOZED";

export type NoteType = "PROPOSAL" | "CONTACT" | "UPDATE" | "QUOTE";

export type PayScheduleType =
  | "QUINCENAL_15_30"
  | "QUINCENAL_1_15"
  | "CUSTOM_DAYS"
  | "CATORCENAL";

export type ExpenseCategory =
  | "MEDICATION"
  | "APPOINTMENT"
  | "LAB_TEST"
  | "IMAGING"
  | "PROCEDURE"
  | "THERAPY"
  | "INSURANCE"
  | "OTHER";

export type ExpenseStatus = "PAID" | "PLANNED" | "CANCELLED";

export interface MedicationScheduleSummary {
  schedule_id: string;
  cluster_id: string | null;
  cluster_label: string | null;
  ideal_time: string;
  effective_clustered_time: string;
  day_of_week: number | null;
}

export interface Medication {
  id: string;
  name: string;
  active_ingredient: string | null;
  presentation: string;
  units_per_package: number | null;
  package_price: number | null;
  dose_amount: number;
  current_stock: number | null;
  frequency_type: MedFrequencyType;
  frequency_value: number;
  tolerance_window_mins: number;
  intake_rule: IntakeConstraint;
  daily_consumption_rate: number;
  days_of_supply_remaining: number | null;
  preferred_pharmacy: string | null;
  purchase_priority: number;
  safety_buffer_days: number;
  clinical_notes: string | null;
  is_active: boolean;
  archived_at: string | null;
  discontinuation_reason: string | null;
  created_at: string;
  updated_at: string;
  schedules?: MedicationScheduleSummary[];
}

export interface IntakeCluster {
  id: string;
  label: string;
  anchor_time: string;
  intake_rule: IntakeConstraint;
  is_active: boolean;
}

export interface ClusterIntakeItem {
  intake_log_id: string;
  medication_id: string;
  schedule_id: string | null;
  medication_name: string;
  active_ingredient: string | null;
  presentation: string;
  units_per_package: number | null;
  dose_amount: number;
  quantity_deducted: number;
  intake_rule: IntakeConstraint;
  ideal_time: string | null;
  effective_clustered_time: string | null;
  scheduled_for: string;
  taken_at: string | null;
  status: IntakeStatus;
  recorded_by: string | null;
  observations: string | null;
  current_stock: number | null;
  days_of_supply_remaining: number | null;
}

export interface TodayClusterBlock {
  cluster_id: string;
  label: string;
  anchor_time: string;
  intake_rule: IntakeConstraint;
  block_status: "PENDING" | "PARTIAL" | "TAKEN" | "DELAYED" | "SKIPPED";
  telegram_notification: {
    id: string;
    status: AlertStatus;
    sent_at: string | null;
    acknowledged_at: string | null;
    acknowledged_by_chat_id: string | null;
    callback_action_payload: string | null;
  } | null;
  items: ClusterIntakeItem[];
}

export interface CascadeStageSummary {
  id: string;
  stage: AlertStage;
  status: AlertStatus;
  trigger_at: string;
  sent_at: string | null;
  acknowledged_at: string | null;
  title: string;
}

export interface ClinicalEventItem {
  id: string;
  title: string;
  category: EventCategory;
  specialist_or_center: string | null;
  location_address: string | null;
  event_datetime: string;
  is_recurring: boolean;
  recurrence_interval_days: number | null;
  medication_id: string | null;
  medication_name: string | null;
  parent_event_id: string | null;
  preparation_instructions: string | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  periodicity_label: string | null;
  date_is_estimated: boolean;
  notes: string | null;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at?: string;
  cascade_alerts: CascadeStageSummary[];
}

export interface TopicAnnotation {
  id: string;
  topic_id: string;
  author: string | null;
  note_type: NoteType;
  contact_name: string | null;
  contact_phone: string | null;
  estimated_cost: number | null;
  content: string;
  created_at: string;
  updated_at?: string;
}

export interface FollowUpTopicItem {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  progress_percentage: number;
  estimated_budget: number | null;
  created_at: string;
  updated_at?: string;
  deadline_at: string;
  resolved_at: string | null;
  annotations: TopicAnnotation[];
  cascade_alerts: CascadeStageSummary[];
}

export interface TelegramRecipient {
  id: string;
  full_name: string;
  role: string;
  telegram_chat_id: string;
  receive_med_reminders: boolean;
  receive_restock_alerts: boolean;
  receive_event_reminders: boolean;
  receive_topic_reminders: boolean;
  is_active: boolean;
  created_at: string;
}

export interface NotificationQueueItem {
  id: string;
  source_type: string;
  source_id: string;
  stage: AlertStage;
  trigger_at: string;
  status: AlertStatus;
  title: string;
  message: string;
  callback_action_payload: string | null;
  telegram_message_ids: Array<{
    chat_id: string;
    message_id: number;
    simulated?: boolean;
  }>;
  retry_count: number;
  last_error: string | null;
  idempotency_key: string;
  sent_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_chat_id: string | null;
  created_at: string;
}

export interface FinancialSettings {
  id: number;
  currency: string;
  pay_schedule_type: PayScheduleType;
  payday_1: number;
  payday_2: number;
  biweekly_anchor_date: string | null;
  quincenal_budget_cap: number | null;
  monthly_budget_cap: number | null;
  safety_buffer_days: number;
  planning_horizon_quincenas: number;
  include_events_in_plan: boolean;
  updated_at: string;
}

export interface MedicalExpense {
  id: string;
  title: string;
  category: ExpenseCategory;
  status: ExpenseStatus;
  amount: number;
  expense_date: string;
  quincena_label: string | null;
  medication_id: string | null;
  medication_name?: string | null;
  clinical_event_id: string | null;
  clinical_event_title?: string | null;
  packages_purchased: number | null;
  units_added: number | null;
  provider_or_pharmacy: string | null;
  payment_method: string | null;
  receipt_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlannedMedicationPurchase {
  plan_item_id: string;
  medication_id: string;
  medication_name: string;
  presentation: string;
  packages: number;
  units_per_package: number;
  package_price: number;
  total_cost: number;
  purchase_priority: number;
  preferred_pharmacy: string | null;
  current_stock_at_start: number;
  projected_depletion_date: string;
  recommended_deadline_date: string;
  latest_quincena_idx: number;
  assigned_quincena_idx: number;
  shifted_from_quincena_label: string | null;
  optimization_reason: string | null;
  urgent_before_payday: boolean;
}

export interface PlannedEventExpense {
  event_id: string;
  title: string;
  category: EventCategory;
  event_date: string;
  estimated_cost: number;
  date_is_estimated: boolean;
  specialist_or_center: string | null;
  quincena_idx: number;
}

export interface QuincenaPlanBucket {
  index: number;
  label: string;
  pay_date: string;
  period_end: string;
  medications_subtotal: number;
  events_subtotal: number;
  total_cost: number;
  baseline_total_cost: number;
  over_budget: boolean;
  purchases: PlannedMedicationPurchase[];
  events: PlannedEventExpense[];
}

export interface ReserveAlertItem {
  quincena_label: string;
  pay_date: string;
  total_cost: number;
  events_subtotal: number;
  suggested_per_quincena_reserve: number;
  message: string;
}

export interface FinancialOptimizationSummary {
  monthly_run_rate_meds: number;
  monthly_run_rate_events: number;
  monthly_run_rate_total: number;
  baseline_peak_quincena: number;
  optimized_peak_quincena: number;
  peak_reduction_mxn: number;
  peak_reduction_pct: number;
  average_quincenal_planned: number;
  horizon_total_planned: number;
  paid_current_month_mxn: number;
  paid_total_mxn: number;
  shifted_purchases_count: number;
}

export interface FinancialPlanSnapshot {
  generated_at: string;
  settings: FinancialSettings;
  buckets: QuincenaPlanBucket[];
  summary: FinancialOptimizationSummary;
  reserve_alerts: ReserveAlertItem[];
  incomplete_pricing_medications: Array<{
    id: string;
    name: string;
    missing_fields: string[];
  }>;
}

export interface PatientProfile {
  id: number;
  full_name: string;
  birth_date: string | null;
  blood_type: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  allergies: string | null;
  chronic_conditions: string | null;
  insurance_provider: string | null;
  insurance_policy: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  general_notes: string | null;
  updated_at: string;
}

export interface CareProvider {
  id: string;
  name: string;
  specialty: string;
  clinic_or_center: string | null;
  city: string | null;
  phone: string | null;
  consultation_fee: number | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MedicationAdherenceSummary {
  medication_id: string;
  medication_name: string;
  taken_count: number;
  delayed_count: number;
  skipped_count: number;
  pending_count: number;
  total_count: number;
  adherence_pct: number;
}

export interface GovernanceAuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: string;
  actor: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CommandCenterSnapshot {
  generated_at: string;
  target_date: string;
  db_mode: "NEON_POOL" | "LOCAL_POSTGRES";
  telegram_configured: boolean;
  today_clusters: TodayClusterBlock[];
  unclustered_today_intakes: ClusterIntakeItem[];
  low_stock_medications: Medication[];
  incomplete_medications: Medication[];
  medications: Medication[];
  archived_medications: Medication[];
  clusters: IntakeCluster[];
  upcoming_events: ClinicalEventItem[];
  completed_events: ClinicalEventItem[];
  open_topics: FollowUpTopicItem[];
  completed_topics: FollowUpTopicItem[];
  telegram_recipients: TelegramRecipient[];
  recent_notifications: NotificationQueueItem[];
  financial_settings: FinancialSettings;
  financial_plan: FinancialPlanSnapshot;
  recent_expenses: MedicalExpense[];
  patient_profile: PatientProfile;
  care_providers: CareProvider[];
  adherence_30d: MedicationAdherenceSummary[];
  recent_audit_logs: GovernanceAuditLog[];
}
