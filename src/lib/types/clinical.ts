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

export interface Medication {
  id: string;
  name: string;
  active_ingredient: string | null;
  presentation: string;
  dose_amount: number;
  current_stock: number;
  frequency_type: MedFrequencyType;
  frequency_value: number;
  tolerance_window_mins: number;
  intake_rule: IntakeConstraint;
  daily_consumption_rate: number;
  days_of_supply_remaining: number;
  clinical_notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  schedules?: MedicationScheduleSummary[];
}

export interface MedicationScheduleSummary {
  schedule_id: string;
  cluster_id: string | null;
  cluster_label: string | null;
  ideal_time: string;
  effective_clustered_time: string;
  day_of_week: number | null;
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
  current_stock: number;
  days_of_supply_remaining: number;
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
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
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
}

export interface FollowUpTopicItem {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  progress_percentage: number;
  created_at: string;
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

export interface CommandCenterSnapshot {
  generated_at: string;
  target_date: string;
  db_mode: "NEON_POOL" | "LOCAL_POSTGRES";
  telegram_configured: boolean;
  today_clusters: TodayClusterBlock[];
  low_stock_medications: Medication[];
  medications: Medication[];
  clusters: IntakeCluster[];
  upcoming_events: ClinicalEventItem[];
  completed_events: ClinicalEventItem[];
  open_topics: FollowUpTopicItem[];
  completed_topics: FollowUpTopicItem[];
  telegram_recipients: TelegramRecipient[];
  recent_notifications: NotificationQueueItem[];
}
