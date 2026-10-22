import { z } from "zod";
import { callAgent } from "../llm";
import type { ResearcherOutput } from "./researcher";
import type { StrategistOutput } from "./strategist";

export const CriticOutputSchema = z.object({
  verdict: z.enum(["proceed", "revise", "reject"]),
  issues: z.array(
    z.object({
      severity: z.enum(["minor", "major", "critical"]),
      issue: z.string(),
      affects: z.enum(["research", "strategy"]),
    })
  ),
  recommendation: z.string(),
});

export type CriticOutput = z.infer<typeof CriticOutputSchema>;

const INSTRUCTIONS = `You are the Critic. Review the research and plan for
weak evidence, untested assumptions, and gaps. Be specific and blunt.
For each issue, say whether the root problem is in the research or the strategy.

Also check:
- Does the plan's confidence match the research's evidence? If the research
  is thin or empty and the plan proceeds as if it were solid, raise a critical
  issue with affects "research". Your verdict should not be "proceed".
- If the idea contains an UPDATE, check that the research and plan reflect it.
  Flag any step or conclusion that still depends on the superseded fact.
  
  Also check the evidence quality:
- Flag any figure used for sizing that describes the parent market rather than the target segment.
- Compare each known's confidence to its source_type and flag over-rated
  confidence (for example, high on a single report or an aggregator).
- If bottom_up_estimate exists, check that success_metric is plausible against
  it, and flag an unrealistic share.
- Flag any step that relies on a number the research lists as unknown or null.
- Check scope.assumptions for contradictions with the rest of the research (for
  example, an assumption describing a calculation that does not exist), and
  check that parent_market.size and parent_market.customers describe the same
  geography and category.`;

export async function runCritic(
  idea: string,
  research: ResearcherOutput,
  plan: StrategistOutput
): Promise<CriticOutput> {
  return callAgent({
    name: "critic_output",
    instructions: INSTRUCTIONS,
    input: JSON.stringify({ idea, research, plan }),
    schema: CriticOutputSchema,
  });
}