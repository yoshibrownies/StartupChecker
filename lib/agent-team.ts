import { runResearcher, type ResearcherOutput } from "./agents/researcher";
import { runStrategist, type StrategistOutput } from "./agents/strategist";
import { runCritic, type CriticOutput } from "./agents/critic";

export type AgentName = "researcher" | "strategist" | "critic";

export type TeamEvent =
  | { type: "start"; agent: AgentName }
  | { type: "result"; agent: "researcher"; data: ResearcherOutput }
  | { type: "result"; agent: "strategist"; data: StrategistOutput }
  | { type: "result"; agent: "critic"; data: CriticOutput }
  | { type: "error"; agent: AgentName; message: string }
  | { type: "done" };

export type RunOptions = {
  fault?: "incomplete_research"; // test 2: simulate a failed research step
  update?: {
    // test 3: a key fact changed
    change: string;
    rerunFrom: "researcher" | "strategist";
    previous: { research: ResearcherOutput; plan: StrategistOutput };
  };
};

// Valid against the schema, useless in substance: what a failed tool call looks like downstream.
const FAILED_RESEARCH: ResearcherOutput = {
  summary: "Research step failed: no market data was retrieved.",
  scope: { geography: "unknown", segment: "unknown", assumptions: [] },
  parent_market: { definition: "unknown", size: null, customers: null },
  target_segment: {
    definition: "unknown",
    customers: null,
    annual_spend_per_customer: null,
    searches_tried: [],
    notes: "",
  },
  competitors: [],
  knowns: [],
  unknowns: [],
  sources: [],
  bottom_up_estimate: null,
  estimate_note: "Not computed: research failed.",
};

export async function runAgentTeam(
  baseIdea: string,
  emit: (e: TeamEvent) => void,
  opts: RunOptions = {}
) {
  const { update } = opts;
  const idea = update
    ? `${baseIdea}\n\nUPDATE (supersedes any earlier fact it contradicts): ${update.change}`
    : baseIdea;

  let current: AgentName = "researcher";
  try {
    let research: ResearcherOutput;

    if (update?.rerunFrom === "strategist") {
      research = update.previous.research; // not affected by the change: reuse
    } else {
      current = "researcher";
      emit({ type: "start", agent: current });
      research = opts.fault ? FAILED_RESEARCH : await runResearcher(idea);
      emit({ type: "result", agent: "researcher", data: research });
    }

    current = "strategist";
    emit({ type: "start", agent: current });
    const plan = await runStrategist(idea, research, update?.previous.plan);
    emit({ type: "result", agent: "strategist", data: plan });

    current = "critic";
    emit({ type: "start", agent: current });
    const review = await runCritic(idea, research, plan);
    emit({ type: "result", agent: "critic", data: review });
  } catch (err) {
    emit({
      type: "error",
      agent: current,
      message: err instanceof Error ? err.message : "Unknown error",
    });
  } finally {
    emit({ type: "done" });
  }
}