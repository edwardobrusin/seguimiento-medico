import { ensureInitialized, getDbMode, query } from "@/lib/db/client";
import type {
  ClinicalEventItem,
  CommandCenterSnapshot,
  FollowUpTopicItem,
  IntakeCluster,
  Medication,
  NotificationQueueItem,
  TelegramRecipient,
  TodayClusterBlock,
} from "@/lib/types/clinical";

interface SnapshotSqlPayload {
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

const COMMAND_CENTER_SNAPSHOT_SQL = `
WITH
today_cluster_notifs AS (
  SELECT DISTINCT ON (nq.source_id)
    nq.source_id,
    nq.id,
    nq.status,
    nq.sent_at,
    nq.acknowledged_at,
    nq.acknowledged_by_chat_id,
    nq.callback_action_payload
  FROM notification_queue nq
  WHERE nq.source_type = 'MEDICATION_INTAKE'
    AND nq.idempotency_key = ('CLUSTER_' || nq.source_id::text || '_' || $1::text)
  ORDER BY nq.source_id, nq.created_at DESC
),
today_cluster_items AS (
  SELECT
    il.cluster_id,
    il.status AS log_status,
    m.name AS med_name,
    json_build_object(
      'intake_log_id', il.id,
      'medication_id', il.medication_id,
      'schedule_id', il.schedule_id,
      'medication_name', m.name,
      'active_ingredient', m.active_ingredient,
      'presentation', m.presentation,
      'units_per_package', m.units_per_package::float8,
      'dose_amount', m.dose_amount::float8,
      'quantity_deducted', il.quantity_deducted::float8,
      'intake_rule', m.intake_rule,
      'ideal_time', ms.ideal_time::text,
      'effective_clustered_time', ms.effective_clustered_time::text,
      'scheduled_for', il.scheduled_for,
      'taken_at', il.taken_at,
      'status', il.status,
      'recorded_by', il.recorded_by,
      'observations', il.observations,
      'current_stock', m.current_stock::float8,
      'days_of_supply_remaining', m.days_of_supply_remaining::float8
    ) AS item_json
  FROM intake_logs il
  JOIN medications m ON m.id = il.medication_id
  LEFT JOIN medication_schedules ms ON ms.id = il.schedule_id
  WHERE il.cluster_id IS NOT NULL
    AND (il.scheduled_for AT TIME ZONE 'UTC')::date = ($1::text)::date
),
today_clusters_agg AS (
  SELECT
    ic.id AS cluster_id,
    ic.label,
    ic.anchor_time,
    ic.intake_rule,
    CASE
      WHEN COUNT(*) FILTER (WHERE tci.log_status = 'TAKEN') = COUNT(*) THEN 'TAKEN'
      WHEN COUNT(*) FILTER (WHERE tci.log_status = 'TAKEN') > 0
       AND COUNT(*) FILTER (WHERE tci.log_status = 'PENDING') > 0 THEN 'PARTIAL'
      ELSE 'PENDING'
    END AS block_status,
    CASE
      WHEN tcn.id IS NOT NULL THEN json_build_object(
        'id', tcn.id,
        'status', tcn.status,
        'sent_at', tcn.sent_at,
        'acknowledged_at', tcn.acknowledged_at,
        'acknowledged_by_chat_id', tcn.acknowledged_by_chat_id,
        'callback_action_payload', tcn.callback_action_payload
      )
      ELSE NULL
    END AS telegram_notification,
    json_agg(tci.item_json ORDER BY tci.med_name ASC) AS items
  FROM intake_clusters ic
  JOIN today_cluster_items tci ON tci.cluster_id = ic.id
  LEFT JOIN today_cluster_notifs tcn ON tcn.source_id = ic.id
  WHERE ic.is_active = TRUE
  GROUP BY
    ic.id, ic.label, ic.anchor_time, ic.intake_rule,
    tcn.id, tcn.status, tcn.sent_at, tcn.acknowledged_at,
    tcn.acknowledged_by_chat_id, tcn.callback_action_payload
),
med_schedules_agg AS (
  SELECT
    ms.medication_id,
    json_agg(
      json_build_object(
        'schedule_id', ms.id,
        'cluster_id', ms.cluster_id,
        'cluster_label', ic.label,
        'ideal_time', ms.ideal_time::text,
        'effective_clustered_time', ms.effective_clustered_time::text,
        'day_of_week', ms.day_of_week
      )
      ORDER BY ms.effective_clustered_time ASC
    ) AS schedules
  FROM medication_schedules ms
  LEFT JOIN intake_clusters ic ON ic.id = ms.cluster_id
  WHERE ms.is_active = TRUE
  GROUP BY ms.medication_id
),
active_medications AS (
  SELECT
    m.id,
    m.name,
    m.active_ingredient,
    m.presentation,
    m.units_per_package::float8 AS units_per_package,
    m.dose_amount::float8 AS dose_amount,
    m.current_stock::float8 AS current_stock,
    m.frequency_type,
    m.frequency_value,
    m.tolerance_window_mins,
    m.intake_rule,
    m.daily_consumption_rate::float8 AS daily_consumption_rate,
    m.days_of_supply_remaining::float8 AS days_of_supply_remaining,
    m.clinical_notes,
    m.is_active,
    m.created_at,
    m.updated_at,
    COALESCE(msa.schedules, '[]'::json) AS schedules
  FROM medications m
  LEFT JOIN med_schedules_agg msa ON msa.medication_id = m.id
  WHERE m.is_active = TRUE
),
active_clusters AS (
  SELECT
    ic.id,
    ic.label,
    ic.anchor_time::text AS anchor_time,
    ic.intake_rule,
    ic.is_active
  FROM intake_clusters ic
  WHERE ic.is_active = TRUE
),
event_alerts_agg AS (
  SELECT
    nq.source_id,
    json_agg(
      json_build_object(
        'id', nq.id,
        'stage', nq.stage,
        'status', nq.status,
        'trigger_at', nq.trigger_at,
        'sent_at', nq.sent_at,
        'acknowledged_at', nq.acknowledged_at,
        'title', nq.title
      )
      ORDER BY nq.trigger_at ASC
    ) AS cascade_alerts
  FROM notification_queue nq
  WHERE nq.source_type = 'CLINICAL_EVENT'
  GROUP BY nq.source_id
),
upcoming_events_cte AS (
  SELECT
    ce.id,
    ce.title,
    ce.category,
    ce.specialist_or_center,
    ce.location_address,
    ce.event_datetime,
    ce.is_recurring,
    ce.recurrence_interval_days,
    ce.medication_id,
    m.name AS medication_name,
    ce.parent_event_id,
    ce.preparation_instructions,
    ce.is_completed,
    ce.completed_at,
    ce.created_at,
    COALESCE(eaa.cascade_alerts, '[]'::json) AS cascade_alerts
  FROM clinical_events ce
  LEFT JOIN medications m ON m.id = ce.medication_id
  LEFT JOIN event_alerts_agg eaa ON eaa.source_id = ce.id
  WHERE ce.is_completed = FALSE
  ORDER BY ce.event_datetime ASC
  LIMIT 20
),
completed_events_cte AS (
  SELECT
    ce.id,
    ce.title,
    ce.category,
    ce.specialist_or_center,
    ce.location_address,
    ce.event_datetime,
    ce.is_recurring,
    ce.recurrence_interval_days,
    ce.medication_id,
    m.name AS medication_name,
    ce.parent_event_id,
    ce.preparation_instructions,
    ce.is_completed,
    ce.completed_at,
    ce.created_at,
    COALESCE(eaa.cascade_alerts, '[]'::json) AS cascade_alerts
  FROM clinical_events ce
  LEFT JOIN medications m ON m.id = ce.medication_id
  LEFT JOIN event_alerts_agg eaa ON eaa.source_id = ce.id
  WHERE ce.is_completed = TRUE
  ORDER BY ce.completed_at DESC NULLS LAST, ce.event_datetime DESC
  LIMIT 10
),
topic_annotations_agg AS (
  SELECT
    ta.topic_id,
    json_agg(
      json_build_object(
        'id', ta.id,
        'topic_id', ta.topic_id,
        'author', ta.author,
        'note_type', ta.note_type,
        'contact_name', ta.contact_name,
        'contact_phone', ta.contact_phone,
        'estimated_cost', ta.estimated_cost::float8,
        'content', ta.content,
        'created_at', ta.created_at
      )
      ORDER BY ta.created_at DESC
    ) AS annotations
  FROM topic_annotations ta
  GROUP BY ta.topic_id
),
topic_alerts_agg AS (
  SELECT
    nq.source_id,
    json_agg(
      json_build_object(
        'id', nq.id,
        'stage', nq.stage,
        'status', nq.status,
        'trigger_at', nq.trigger_at,
        'sent_at', nq.sent_at,
        'acknowledged_at', nq.acknowledged_at,
        'title', nq.title
      )
      ORDER BY nq.trigger_at ASC
    ) AS cascade_alerts
  FROM notification_queue nq
  WHERE nq.source_type = 'FOLLOW_UP_DEADLINE'
  GROUP BY nq.source_id
),
open_topics_cte AS (
  SELECT
    ft.id,
    ft.title,
    ft.description,
    ft.status,
    ft.priority,
    ft.progress_percentage,
    ft.created_at,
    ft.deadline_at,
    ft.resolved_at,
    COALESCE(taa.annotations, '[]'::json) AS annotations,
    COALESCE(tla.cascade_alerts, '[]'::json) AS cascade_alerts
  FROM follow_up_topics ft
  LEFT JOIN topic_annotations_agg taa ON taa.topic_id = ft.id
  LEFT JOIN topic_alerts_agg tla ON tla.source_id = ft.id
  WHERE ft.status != 'COMPLETED'
  ORDER BY ft.deadline_at ASC
),
completed_topics_cte AS (
  SELECT
    ft.id,
    ft.title,
    ft.description,
    ft.status,
    ft.priority,
    ft.progress_percentage,
    ft.created_at,
    ft.deadline_at,
    ft.resolved_at,
    COALESCE(taa.annotations, '[]'::json) AS annotations,
    COALESCE(tla.cascade_alerts, '[]'::json) AS cascade_alerts
  FROM follow_up_topics ft
  LEFT JOIN topic_annotations_agg taa ON taa.topic_id = ft.id
  LEFT JOIN topic_alerts_agg tla ON tla.source_id = ft.id
  WHERE ft.status = 'COMPLETED'
  ORDER BY ft.resolved_at DESC NULLS LAST, ft.deadline_at DESC
  LIMIT 10
),
telegram_recipients_cte AS (
  SELECT
    tr.id,
    tr.full_name,
    tr.role,
    tr.telegram_chat_id,
    tr.receive_med_reminders,
    tr.receive_restock_alerts,
    tr.receive_event_reminders,
    tr.receive_topic_reminders,
    tr.is_active,
    tr.created_at
  FROM telegram_recipients tr
  ORDER BY tr.created_at ASC
),
recent_notifications_cte AS (
  SELECT
    nq.id,
    nq.source_type,
    nq.source_id,
    nq.stage,
    nq.trigger_at,
    nq.status,
    nq.title,
    nq.message,
    nq.callback_action_payload,
    nq.telegram_message_ids,
    nq.retry_count,
    nq.last_error,
    nq.idempotency_key,
    nq.sent_at,
    nq.acknowledged_at,
    nq.acknowledged_by_chat_id,
    nq.created_at
  FROM notification_queue nq
  ORDER BY nq.created_at DESC
  LIMIT 20
)
SELECT json_build_object(
  'today_clusters', COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'cluster_id', tca.cluster_id,
          'label', tca.label,
          'anchor_time', tca.anchor_time::text,
          'intake_rule', tca.intake_rule,
          'block_status', tca.block_status,
          'telegram_notification', tca.telegram_notification,
          'items', tca.items
        )
        ORDER BY tca.anchor_time ASC
      )
      FROM today_clusters_agg tca
    ),
    '[]'::json
  ),
  'low_stock_medications', COALESCE(
    (
      SELECT json_agg(
        row_to_json(am)
        ORDER BY am.days_of_supply_remaining ASC, am.name ASC
      )
      FROM active_medications am
      WHERE am.days_of_supply_remaining <= 7
    ),
    '[]'::json
  ),
  'medications', COALESCE(
    (
      SELECT json_agg(row_to_json(am) ORDER BY am.name ASC)
      FROM active_medications am
    ),
    '[]'::json
  ),
  'clusters', COALESCE(
    (
      SELECT json_agg(row_to_json(ac) ORDER BY ac.anchor_time ASC)
      FROM active_clusters ac
    ),
    '[]'::json
  ),
  'upcoming_events', COALESCE(
    (
      SELECT json_agg(row_to_json(ue) ORDER BY ue.event_datetime ASC)
      FROM upcoming_events_cte ue
    ),
    '[]'::json
  ),
  'completed_events', COALESCE(
    (
      SELECT json_agg(
        row_to_json(ce)
        ORDER BY ce.completed_at DESC NULLS LAST, ce.event_datetime DESC
      )
      FROM completed_events_cte ce
    ),
    '[]'::json
  ),
  'open_topics', COALESCE(
    (
      SELECT json_agg(row_to_json(ot) ORDER BY ot.deadline_at ASC)
      FROM open_topics_cte ot
    ),
    '[]'::json
  ),
  'completed_topics', COALESCE(
    (
      SELECT json_agg(
        row_to_json(ct)
        ORDER BY ct.resolved_at DESC NULLS LAST, ct.deadline_at DESC
      )
      FROM completed_topics_cte ct
    ),
    '[]'::json
  ),
  'telegram_recipients', COALESCE(
    (
      SELECT json_agg(row_to_json(tr) ORDER BY tr.created_at ASC)
      FROM telegram_recipients_cte tr
    ),
    '[]'::json
  ),
  'recent_notifications', COALESCE(
    (
      SELECT json_agg(row_to_json(rn) ORDER BY rn.created_at DESC)
      FROM recent_notifications_cte rn
    ),
    '[]'::json
  )
) AS snapshot;
`;

export async function getCommandCenterSnapshot(
  targetDateStr?: string
): Promise<CommandCenterSnapshot> {
  await ensureInitialized();

  const trimmed = targetDateStr?.trim();
  const dateStr =
    trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? trimmed
      : new Date().toISOString().slice(0, 10);

  const res = await query<{ snapshot: SnapshotSqlPayload | string }>(
    COMMAND_CENTER_SNAPSHOT_SQL,
    [dateStr]
  );

  const rawSnapshot = res.rows[0]?.snapshot;
  const parsed: SnapshotSqlPayload =
    typeof rawSnapshot === "string"
      ? (JSON.parse(rawSnapshot) as SnapshotSqlPayload)
      : rawSnapshot ?? {
          today_clusters: [],
          low_stock_medications: [],
          medications: [],
          clusters: [],
          upcoming_events: [],
          completed_events: [],
          open_topics: [],
          completed_topics: [],
          telegram_recipients: [],
          recent_notifications: [],
        };

  return {
    generated_at: new Date().toISOString(),
    target_date: dateStr,
    db_mode: getDbMode(),
    telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    today_clusters: parsed.today_clusters ?? [],
    low_stock_medications: parsed.low_stock_medications ?? [],
    medications: parsed.medications ?? [],
    clusters: parsed.clusters ?? [],
    upcoming_events: parsed.upcoming_events ?? [],
    completed_events: parsed.completed_events ?? [],
    open_topics: parsed.open_topics ?? [],
    completed_topics: parsed.completed_topics ?? [],
    telegram_recipients: parsed.telegram_recipients ?? [],
    recent_notifications: parsed.recent_notifications ?? [],
  };
}
