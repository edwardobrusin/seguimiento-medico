import { NextResponse } from "next/server";
import { z } from "zod";
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
  }),
  z.object({
    action: z.literal("update_topic"),
    topic_id: z.string().uuid(),
    status: z
      .enum(["PENDING", "IN_PROGRESS", "WAITING_RESPONSE", "COMPLETED"])
      .optional(),
    priority: z.number().int().min(1).max(3).optional(),
    progress_percentage: z.number().int().min(0).max(100).optional(),
    deadline_at: z.string().optional(),
    description: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("add_annotation"),
    topic_id: z.string().uuid(),
    author: z.string().max(100).nullable().optional(),
    note_type: z.enum(["PROPOSAL", "CONTACT", "UPDATE", "QUOTE"]).default("PROPOSAL"),
    contact_name: z.string().max(150).nullable().optional(),
    contact_phone: z.string().max(50).nullable().optional(),
    estimated_cost: z.number().min(0).nullable().optional(),
    content: z.string().min(1),
  }),
]);

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = topicActionSchema.parse(raw);

    if (body.action === "create_topic") {
      const topic = await FollowUpTopicsService.createFollowUpTopic(body);
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
          status: body.status,
          priority: body.priority,
          progress_percentage: body.progress_percentage,
          deadline_at: body.deadline_at,
          description: body.description,
        }
      );
      safeRevalidateHome();
      return NextResponse.json(
        { ok: true, topic },
        { headers: NO_STORE_HEADERS }
      );
    }

    const annotation = await FollowUpTopicsService.addTopicAnnotation(body);
    safeRevalidateHome();
    return NextResponse.json(
      { ok: true, annotation },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Error al procesar tema de seguimiento.";
    return NextResponse.json(
      { error: message },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}
