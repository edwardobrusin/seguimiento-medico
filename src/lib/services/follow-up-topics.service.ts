import { query, withTransaction } from "@/lib/db/client";
import type {
  ClinicalEventItem,
  FollowUpTopicItem,
  NoteType,
  TaskStatus,
  TopicAnnotation,
} from "@/lib/types/clinical";
import {
  ClinicalEventsService,
  type CreateClinicalEventInput,
} from "./clinical-events.service";
import { GovernanceAuditService } from "./governance-audit.service";

export interface CreateTopicInput {
  title: string;
  description?: string | null;
  priority: number;
  deadline_at: string;
  estimated_budget?: number | null;
}

export interface UpdateTopicInput {
  title?: string;
  status?: TaskStatus;
  priority?: number;
  progress_percentage?: number;
  deadline_at?: string;
  description?: string | null;
  estimated_budget?: number | null;
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

export interface UpdateAnnotationInput {
  author?: string | null;
  note_type: NoteType;
  contact_name?: string | null;
  contact_phone?: string | null;
  estimated_cost?: number | null;
  content: string;
}

export class FollowUpTopicsService {
  static async createFollowUpTopic(
    input: CreateTopicInput,
    actor = "Consola Clinica Web"
  ): Promise<FollowUpTopicItem> {
    return withTransaction(async (tx) => {
      const res = await tx.query<FollowUpTopicItem>(
        `INSERT INTO follow_up_topics (
           title, description, priority, deadline_at, estimated_budget
         ) VALUES ($1, $2, $3, $4::timestamptz, $5)
         RETURNING *,
           estimated_budget::float8 AS estimated_budget`,
        [
          input.title.trim(),
          input.description?.trim() || null,
          input.priority,
          input.deadline_at,
          input.estimated_budget ?? null,
        ]
      );

      const topic = res.rows[0];
      await tx.query(
        `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1::uuid, $2, $3, $4::timestamptz)`,
        [topic.id, topic.title, topic.description ?? "", topic.deadline_at]
      );

      await GovernanceAuditService.log(
        {
          entity_type: "FOLLOW_UP_TOPIC",
          entity_id: topic.id,
          entity_label: topic.title,
          action: "CREATE",
          actor,
          summary: `Tema de seguimiento "${topic.title}" creado (prioridad ${topic.priority}).`,
        },
        tx
      );

      return { ...topic, annotations: [], cascade_alerts: [] };
    });
  }

  static async updateFollowUpTopic(
    topicId: string,
    updates: UpdateTopicInput,
    actor = "Consola Clinica Web"
  ): Promise<FollowUpTopicItem> {
    return withTransaction(async (tx) => {
      const prevRes = await tx.query<FollowUpTopicItem>(
        `SELECT *, estimated_budget::float8 AS estimated_budget
         FROM follow_up_topics WHERE id = $1::uuid`,
        [topicId]
      );
      const prev = prevRes.rows[0];
      if (!prev) {
        throw new Error("Tema de seguimiento no encontrado.");
      }

      const nextTitle = updates.title?.trim() || prev.title;
      const nextStatus = updates.status ?? prev.status;
      const nextProgress =
        nextStatus === "COMPLETED"
          ? 100
          : updates.progress_percentage ?? prev.progress_percentage;
      const nextPriority = updates.priority ?? prev.priority;
      const nextDeadline = updates.deadline_at ?? prev.deadline_at;
      const nextDescription =
        updates.description !== undefined
          ? updates.description?.trim() || null
          : prev.description;
      const nextBudget =
        updates.estimated_budget !== undefined
          ? updates.estimated_budget
          : prev.estimated_budget;

      const updatedRes = await tx.query<FollowUpTopicItem>(
        `UPDATE follow_up_topics
         SET title = $2,
             status = $3::task_status,
             priority = $4,
             progress_percentage = $5,
             deadline_at = $6::timestamptz,
             description = $7,
             estimated_budget = $8,
             updated_at = NOW(),
             resolved_at = CASE
               WHEN $3::task_status = 'COMPLETED' AND resolved_at IS NULL THEN NOW()
               WHEN $3::task_status != 'COMPLETED' THEN NULL
               ELSE resolved_at
             END
         WHERE id = $1::uuid
         RETURNING *,
           estimated_budget::float8 AS estimated_budget`,
        [
          topicId,
          nextTitle,
          nextStatus,
          nextPriority,
          nextProgress,
          nextDeadline,
          nextDescription,
          nextBudget ?? null,
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
             AND source_id = $1::uuid
             AND status = 'QUEUED'`,
          [topicId]
        );
      } else if (
        (updates.deadline_at && updates.deadline_at !== prev.deadline_at) ||
        (updates.title && updates.title.trim() !== prev.title)
      ) {
        await tx.query(
          `DELETE FROM notification_queue
           WHERE source_type = 'FOLLOW_UP_DEADLINE'
             AND source_id = $1::uuid
             AND status = 'QUEUED'`,
          [topicId]
        );

        await tx.query(
          `SELECT fn_schedule_cascading_alerts('FOLLOW_UP_DEADLINE', $1::uuid, $2, $3, $4::timestamptz)`,
          [
            updated.id,
            updated.title,
            updated.description ?? "",
            updated.deadline_at,
          ]
        );
      }

      await GovernanceAuditService.log(
        {
          entity_type: "FOLLOW_UP_TOPIC",
          entity_id: updated.id,
          entity_label: updated.title,
          action: "UPDATE",
          actor,
          summary: `Tema "${updated.title}" actualizado (${updated.status}, ${updated.progress_percentage}%).`,
        },
        tx
      );

      return { ...updated, annotations: [], cascade_alerts: [] };
    });
  }

  static async deleteFollowUpTopic(
    topicId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    return withTransaction(async (tx) => {
      await tx.query(
        `DELETE FROM notification_queue
         WHERE source_type = 'FOLLOW_UP_DEADLINE'
           AND source_id = $1::uuid`,
        [topicId]
      );

      const res = await tx.query<{ id: string; title: string }>(
        `DELETE FROM follow_up_topics
         WHERE id = $1::uuid
         RETURNING id, title`,
        [topicId]
      );
      const deleted = res.rows[0];
      if (!deleted) {
        throw new Error("Tema de seguimiento no encontrado.");
      }

      await GovernanceAuditService.log(
        {
          entity_type: "FOLLOW_UP_TOPIC",
          entity_id: deleted.id,
          entity_label: deleted.title,
          action: "DELETE",
          actor,
          summary: `Tema de seguimiento "${deleted.title}" y su bitacora eliminados.`,
        },
        tx
      );

      return { deletedId: deleted.id };
    });
  }

  static async addTopicAnnotation(
    input: AddAnnotationInput,
    actor = "Consola Clinica Web"
  ): Promise<TopicAnnotation> {
    const res = await query<TopicAnnotation>(
      `INSERT INTO topic_annotations (
         topic_id, author, note_type, contact_name, contact_phone, estimated_cost, content
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
       RETURNING *,
         estimated_cost::float8 AS estimated_cost`,
      [
        input.topic_id,
        input.author?.trim() || "Cuidador",
        input.note_type,
        input.contact_name?.trim() || null,
        input.contact_phone?.trim() || null,
        input.estimated_cost ?? null,
        input.content.trim(),
      ]
    );
    const ann = res.rows[0];
    await GovernanceAuditService.log({
      entity_type: "TOPIC_ANNOTATION",
      entity_id: ann.id,
      entity_label: ann.contact_name ?? ann.note_type,
      action: "CREATE",
      actor,
      summary: `Anotacion (${ann.note_type}) agregada al tema ${input.topic_id}.`,
    });
    return ann;
  }

  static async updateTopicAnnotation(
    annotationId: string,
    input: UpdateAnnotationInput,
    actor = "Consola Clinica Web"
  ): Promise<TopicAnnotation> {
    const res = await query<TopicAnnotation>(
      `UPDATE topic_annotations
       SET author = COALESCE($2, author),
           note_type = $3,
           contact_name = $4,
           contact_phone = $5,
           estimated_cost = $6,
           content = $7,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING *,
         estimated_cost::float8 AS estimated_cost`,
      [
        annotationId,
        input.author?.trim() || null,
        input.note_type,
        input.contact_name?.trim() || null,
        input.contact_phone?.trim() || null,
        input.estimated_cost ?? null,
        input.content.trim(),
      ]
    );
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Anotacion de bitacora no encontrada.");
    }
    await GovernanceAuditService.log({
      entity_type: "TOPIC_ANNOTATION",
      entity_id: updated.id,
      entity_label: updated.contact_name ?? updated.note_type,
      action: "UPDATE",
      actor,
      summary: `Anotacion de bitacora actualizada.`,
    });
    return updated;
  }

  static async deleteTopicAnnotation(
    annotationId: string,
    actor = "Consola Clinica Web"
  ): Promise<{ deletedId: string }> {
    const res = await query<{ id: string; topic_id: string }>(
      `DELETE FROM topic_annotations
       WHERE id = $1::uuid
       RETURNING id, topic_id`,
      [annotationId]
    );
    const deleted = res.rows[0];
    if (!deleted) {
      throw new Error("Anotacion de bitacora no encontrada.");
    }
    await GovernanceAuditService.log({
      entity_type: "TOPIC_ANNOTATION",
      entity_id: deleted.id,
      entity_label: deleted.topic_id,
      action: "DELETE",
      actor,
      summary: `Anotacion eliminada de la bitacora del tema.`,
    });
    return { deletedId: deleted.id };
  }

  static async convertTopicToEvent(
    topicId: string,
    eventInput: CreateClinicalEventInput,
    markTopicCompleted = true,
    actor = "Consola Clinica Web"
  ): Promise<{ event: ClinicalEventItem; topic: FollowUpTopicItem }> {
    const createdEvent = await ClinicalEventsService.createClinicalEvent(
      eventInput,
      actor
    );

    await this.addTopicAnnotation(
      {
        topic_id: topicId,
        author: actor,
        note_type: "UPDATE",
        contact_name: eventInput.specialist_or_center ?? null,
        estimated_cost: eventInput.estimated_cost ?? null,
        content: `Convertido a evento en Agenda Clinica: "${createdEvent.title}" para ${createdEvent.event_datetime.slice(0, 16)}.`,
      },
      actor
    );

    const updatedTopic = await this.updateFollowUpTopic(
      topicId,
      markTopicCompleted
        ? { status: "COMPLETED", progress_percentage: 100 }
        : { status: "IN_PROGRESS" },
      actor
    );

    await GovernanceAuditService.log({
      entity_type: "FOLLOW_UP_TOPIC",
      entity_id: topicId,
      entity_label: updatedTopic.title,
      action: "CONVERT_EVENT",
      actor,
      summary: `Tema "${updatedTopic.title}" convertido en evento clinico "${createdEvent.title}".`,
    });

    return { event: createdEvent, topic: updatedTopic };
  }
}
