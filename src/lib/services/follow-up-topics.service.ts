import { query, withTransaction } from "@/lib/db/client";
import type {
  FollowUpTopicItem,
  NoteType,
  TaskStatus,
  TopicAnnotation,
} from "@/lib/types/clinical";

export interface CreateTopicInput {
  title: string;
  description?: string | null;
  priority: number;
  deadline_at: string;
}

export interface UpdateTopicInput {
  status?: TaskStatus;
  priority?: number;
  progress_percentage?: number;
  deadline_at?: string;
  description?: string | null;
}

export interface AddAnnotationInput {
  topic_id: string;
  author?: string | null;
  note_type: NoteType;
  contact_name?: string | null;
  contact_phone?: string | null;
  estimated_cost?: number | null;
  content: string;
}

export class FollowUpTopicsService {
  static async createFollowUpTopic(
    input: CreateTopicInput
  ): Promise<FollowUpTopicItem> {
    return withTransaction(async (tx) => {
      const res = await tx.query<FollowUpTopicItem>(
        `INSERT INTO follow_up_topics (
           title, description, priority, deadline_at
         ) VALUES ($1, $2, $3, $4::timestamptz)
         RETURNING *`,
        [
          input.title,
          input.description ?? null,
          input.priority,
          input.deadline_at,
        ]
      );

      const topic = res.rows[0];
      await tx.query(
        `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1, $2, $3, $4::timestamptz)`,
        [topic.id, topic.title, topic.description ?? "", topic.deadline_at]
      );

      return { ...topic, annotations: [], cascade_alerts: [] };
    });
  }

  static async updateFollowUpTopic(
    topicId: string,
    updates: UpdateTopicInput
  ): Promise<FollowUpTopicItem> {
    return withTransaction(async (tx) => {
      const prevRes = await tx.query<FollowUpTopicItem>(
        `SELECT * FROM follow_up_topics WHERE id = $1`,
        [topicId]
      );
      const prev = prevRes.rows[0];
      if (!prev) {
        throw new Error("Tema de seguimiento no encontrado.");
      }

      const nextStatus = updates.status ?? prev.status;
      const nextProgress =
        nextStatus === "COMPLETED"
          ? 100
          : updates.progress_percentage ?? prev.progress_percentage;
      const nextPriority = updates.priority ?? prev.priority;
      const nextDeadline = updates.deadline_at ?? prev.deadline_at;
      const nextDescription =
        updates.description !== undefined
          ? updates.description
          : prev.description;

      const updatedRes = await tx.query<FollowUpTopicItem>(
        `UPDATE follow_up_topics
         SET status = $2::task_status,
             priority = $3,
             progress_percentage = $4,
             deadline_at = $5::timestamptz,
             description = $6,
             resolved_at = CASE
               WHEN $2::task_status = 'COMPLETED' AND resolved_at IS NULL THEN NOW()
               WHEN $2::task_status != 'COMPLETED' THEN NULL
               ELSE resolved_at
             END
         WHERE id = $1
         RETURNING *`,
        [
          topicId,
          nextStatus,
          nextPriority,
          nextProgress,
          nextDeadline,
          nextDescription,
        ]
      );

      const updated = updatedRes.rows[0];

      if (nextStatus === "COMPLETED") {
        await tx.query(
          `UPDATE notification_queue
           SET status = 'ACKNOWLEDGED',
               acknowledged_at = NOW(),
               acknowledged_by_chat_id = 'TOPIC_COMPLETED'
           WHERE source_type = 'FOLLOW_UP_DEADLINE'
             AND source_id = $1
             AND status = 'QUEUED'`,
          [topicId]
        );
      } else if (updates.deadline_at && updates.deadline_at !== prev.deadline_at) {
        await tx.query(
          `DELETE FROM notification_queue
           WHERE source_type = 'FOLLOW_UP_DEADLINE'
             AND source_id = $1
             AND status = 'QUEUED'`,
          [topicId]
        );

        await tx.query(
          `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1, $2, $3, $4::timestamptz)`,
          [
            updated.id,
            updated.title,
            updated.description ?? "",
            updated.deadline_at,
          ]
        );
      }

      return { ...updated, annotations: [], cascade_alerts: [] };
    });
  }

  static async addTopicAnnotation(
    input: AddAnnotationInput
  ): Promise<TopicAnnotation> {
    const res = await query<TopicAnnotation>(
      `INSERT INTO topic_annotations (
         topic_id, author, note_type, contact_name, contact_phone, estimated_cost, content
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *,
         estimated_cost::float8 AS estimated_cost`,
      [
        input.topic_id,
        input.author ?? "Cuidador",
        input.note_type,
        input.contact_name ?? null,
        input.contact_phone ?? null,
        input.estimated_cost ?? null,
        input.content,
      ]
    );
    return res.rows[0];
  }
}
