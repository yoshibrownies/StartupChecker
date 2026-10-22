import { z } from "zod";
import { auth } from "@/auth";
import { runAgentTeam, type TeamEvent } from "@/lib/agent-team";
import { ResearcherOutputSchema } from "@/lib/agents/researcher";
import { StrategistOutputSchema } from "@/lib/agents/strategist";

export const maxDuration = 60;

const BodySchema = z.object({
  idea: z.string().trim().min(10).max(2000),
  fault: z.literal("incomplete_research").optional(),
  update: z
    .object({
      change: z.string().trim().min(5).max(500),
      rerunFrom: z.enum(["researcher", "strategist"]),
      previous: z.object({
        research: ResearcherOutputSchema,
        plan: StrategistOutputSchema,
      }),
    })
    .optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request. Describe the idea in 10 to 2000 characters." },
      { status: 400 }
    );
  }
  const { idea, fault, update } = parsed.data;

  // Fault injection only works when explicitly enabled on the server
  const options = {
    update,
    fault: process.env.ENABLE_TEST_FAULTS === "true" ? fault : undefined,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: TeamEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      await runAgentTeam(idea, emit, options);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}