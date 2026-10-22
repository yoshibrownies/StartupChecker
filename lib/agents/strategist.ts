import { z } from "zod";
import { callAgent } from "../llm";
import type { ResearcherOutput } from "./researcher";

export const StrategistOutputSchema = z.object({
  summary: z.string(),
  research_limitations: z.array(z.string()),
  changes_from_previous: z.array(z.string()),
  steps: z.array(z.object({ action: z.string(), rationale: z.string() })),
  assumptions: z.array(z.string()),
  success_metric: z.string(),
});

export type StrategistOutput = z.infer<typeof StrategistOutputSchema>;

const INSTRUCTIONS = `You are the Strategist. Using the research, propose a
concrete plan to validate and launch this idea. Address the unknowns
directly: your early steps should resolve them. List every assumption
the plan depends on. Only propose steps that use existing, available technology 
and methods; do not rely on products that do not exist yet.

Check the research before you rely on it:
- If it is empty, thin, or missing what you need, do NOT invent substitutes
  or statistics. List each gap in research_limitations, make your first steps
  about obtaining that information, and keep the plan proportionate to the
  evidence. If the research is adequate, research_limitations may be [].

Updates:
- If the idea contains an UPDATE and previous_plan is provided, the previous
  plan may be stale. Revise it: drop steps that depended on the old fact, add
  what the new fact requires, and describe each change and why in
  changes_from_previous. Do not return the previous plan unchanged.
- On a first run (previous_plan is null), return changes_from_previous as [].

Use the research's numbers:
- Cite specific figures in step rationales rather than generalities.
- Check research.scope. If its geography or segment assumption looks wrong for
  the idea, say so in research_limitations.
- parent_market is context only. Only target_segment describes the people the
  idea serves. Do not size the opportunity from parent_market figures.
- bottom_up_estimate, when present, is a ceiling (everyone in the segment
  spending the full annual amount), not a forecast. Express success_metric as a
  realistic share of it and state the revenue that share implies. If it is
  null, your first steps must establish the missing segment figures (see
  estimate_note and unknowns).
- Treat knowns with low confidence, or source_type aggregator or
  company_self_reported, as unverified: do not rest a step on one without a
  step that validates it.`;

export async function runStrategist(
  idea: string,
  research: ResearcherOutput,
  previousPlan?: StrategistOutput
): Promise<StrategistOutput> {
  return callAgent({
    name: "strategist_output",
    instructions: INSTRUCTIONS,
    input: JSON.stringify({ idea, research, previous_plan: previousPlan ?? null }),
    schema: StrategistOutputSchema,
  });
}