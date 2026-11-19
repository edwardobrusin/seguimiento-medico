import { NextResponse } from "next/server";
import { z } from "zod";
import { getActorLabel, requireAdmin, requireSession } from "@/lib/auth/session";
import { formatApiError } from "@/lib/api-error";
import { FollowUpTopicsService } from "@/lib/services/follow-up-topics.service";
import { NO_STORE_HEADERS, safeRevalidateHome } from "@/lib/vercel-cache";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

const topicActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_topic"),
    title: z.string().min(1).max(200),
    description: z.string().nullable().optional(),
    priority: z.number().int().min(1).max(3).default(2),
    deadline_at: z.string().min(1),
    estimated_budget: z.number().min(0).nullable().optional(),
  }),
  z.object({
    action: z.literal("update_topic"),
    topic_id: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
    status: z
      .enum(["PENDING", "IN_PROGRESS", "WAITING_RESPONSE", "COMPLETED"])
      .optional(),
    priority: z.number().int().min(1).max(3).optional(),
    progress_percentage: z.number().int().min(0).max(100).optional(),
    deadline_at: z.string().optional(),
    description: z.string().nullable().optional(),
    estimated_budget: z.number().min(0).nullable().optional(),
  }),
  z.object({
    action: z.literal("delete_topic"),
    topic_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("add_annotation"),
    topic_id: z.string().uuid(),
    author: z.string().max(100).nullable().optional(),
    note_type: z
      .enum(["PROPOSAL", "CONTACT", "UPDATE", "QUOTE"])
      .default("PROPOSAL"),
    contact_name: z.string().max(150).nullable().optional(),
    contact_phone: z.string().max(50).nullable().optional(),
    estimated_cost: z.number().min(0).nullable().optional(),
    content: z.string().min(1),
  }),
  z.object({
    action: z.literal("update_annotation"),
    annotation_id: z.string().uuid(),
    author: z.string().max(100).nullable().optional(),
    note_type: z
      .enum(["PROPOSAL", "CONTACT", "UPDATE", "QUOTE"])
      .default("PROPOSAL"),
    contact_name: z.string().max(150).nullable().optional(),
    contact_phone: z.string().max(50).nullable().optional(),
    estimated_cost: z.number().min(0).nullable().optional(),
    content: z.string().min(1),
  }),
  z.object({
    action: z.literal("delete_annotation"),
    annotation_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("convert_to_event"),
    topic_id: z.string().uuid(),
    title: z.string().min(1).max(200),
    category: z.enum([
      "APPOINTMENT",
      "INJECTION",
      "LAB_TEST",
      "PROCEDURE",
      "OTHER",
    ]),
    specialist_or_center: z.string().nullable().optional(),
    location_address: z.string().nullable().optional(),
    event_datetime: z.string().min(1),
    estimated_cost: z.number().min(0).nullable().optional(),
    preparation_instructions: z.string().nullable().optional(),
    mark_topic_completed: z.boolean().default(true),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = topicActionSchema.parse(raw);

    const session =
      body.action === "delete_topic" || body.action === "delete_annotation"
        ? await requireAdmin()
        : await requireSession();
    const actor = getActorLabel(session);

    if (body.action === "create_topic") {
      const topic = await FollowUpTopicsService.createFollowUpTopic(
        body,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, topic },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "update_topic") {
      const topic = await FollowUpTopicsService.updateFollowUpTopic(
        body.topic_id,
        {
          title: body.title,
          status: body.status,
          priority: body.priority,
          progress_percentage: body.progress_percentage,
          deadline_at: body.deadline_at,
          description: body.description,
          estimated_budget: body.estimated_budget,
        },
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, topic },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "delete_topic") {
      const result = await FollowUpTopicsService.deleteFollowUpTopic(
        body.topic_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "update_annotation") {
      const annotation = await FollowUpTopicsService.updateTopicAnnotation(
        body.annotation_id,
        body,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, annotation },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "delete_annotation") {
      const result = await FollowUpTopicsService.deleteTopicAnnotation(
        body.annotation_id,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (body.action === "convert_to_event") {
      const result = await FollowUpTopicsService.convertTopicToEvent(
        body.topic_id,
        {
          title: body.title,
          category: body.category,
          specialist_or_center: body.specialist_or_center ?? null,
          location_address: body.location_address ?? null,
          event_datetime: body.event_datetime,
          is_recurring: false,
          estimated_cost: body.estimated_cost ?? null,
          preparation_instructions: body.preparation_instructions ?? null,
        },
        body.mark_topic_completed,
        actor
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, ...result },
        { headers: NO_STORE_HEADERS }
      );
    }

    const annotation = await FollowUpTopicsService.addTopicAnnotation(
      body,
      actor
    );
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, annotation },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const { status, message } = formatApiError(
      err,
      "Error al procesar tema de seguimiento."
    );
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
