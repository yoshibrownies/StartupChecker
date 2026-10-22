"use client";

import { useEffect, useRef, useState } from "react";
// type-only imports: nothing from the server code gets bundled into the browser
import type { AgentName, TeamEvent } from "@/lib/agent-team";
import type { ResearcherOutput } from "@/lib/agents/researcher";
import type { StrategistOutput } from "@/lib/agents/strategist";
import type { CriticOutput } from "@/lib/agents/critic";

type Status = "waiting" | "running" | "done" | "error";

type Run = {
  id: number;
  idea: string;
  note?: string;
  status: Record<AgentName, Status>;
  research?: ResearcherOutput;
  plan?: StrategistOutput;
  review?: CriticOutput;
  error?: string;
  log: string[];
};

type RunExtras = {
    fault?: "incomplete_research";
    update?: {
      change: string;
      rerunFrom: "researcher" | "strategist";
      previous: { research: ResearcherOutput; plan: StrategistOutput };
    };
  };

type MetricT = NonNullable<ResearcherOutput["target_segment"]["customers"]>

const AGENTS: { key: AgentName; label: string; role: string }[] = [
  { key: "researcher", label: "Researcher", role: "What's known and unknown" },
  { key: "strategist", label: "Strategist", role: "Proposes a plan" },
  { key: "critic", label: "Critic", role: "Reviews the issues" },
];

const STATUS_STYLE: Record<Status, string> = {
  waiting: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  done: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  error: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};


export default function ChatApp({
    userName,
    signOutAction,
    testMode,
  }: {
    userName: string;
    signOutAction: () => Promise<void>;
    testMode: boolean;
  }) {
  
  const [runs, setRuns] = useState<Run[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runs]);

  function updateRun(id: number, fn: (r: Run) => Run) {
    setRuns((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));
  }

  function applyEvent(id: number, e: TeamEvent) {
    const time = new Date().toLocaleTimeString();
    updateRun(id, (r) => {
      const next: Run = { ...r, status: { ...r.status }, log: [...r.log] };
      switch (e.type) {
        case "start":
          next.status[e.agent] = "running";
          next.log.push(`${time}  ${e.agent} started`);
          break;
        case "result":
          next.status[e.agent] = "done";
          next.log.push(`${time}  ${e.agent} finished`);
          if (e.agent === "researcher") next.research = e.data;
          if (e.agent === "strategist") next.plan = e.data;
          if (e.agent === "critic") next.review = e.data;
          break;
        case "error":
          next.status[e.agent] = "error";
          next.error = `${e.agent} failed: ${e.message}`;
          next.log.push(`${time}  ${e.agent} FAILED: ${e.message}`);
          break;
        case "done":
          next.log.push(`${time}  run complete`);
          break;
      }
      return next;
    });
  }

  const [simulateFailure, setSimulateFailure] = useState(false);

  async function startRun(idea: string, extras: RunExtras = {}) {
    if (busy) return;
    const id = Date.now();
    const reuse = extras.update?.rerunFrom === "strategist";
    setBusy(true);
    setRuns((prev) => [
      ...prev,
      {
        id,
        idea,
        note: extras.update
          ? `Update: ${extras.update.change}`
          : extras.fault
            ? "Test: researcher failure simulated"
            : undefined,
        status: {
          researcher: reuse ? "done" : "waiting",
          strategist: "waiting",
          critic: "waiting",
        },
        research: reuse ? extras.update!.previous.research : undefined,
        log: reuse ? ["researcher reused (not affected by the change)"] : [],
      },
    ]);
  
    try {
      const res = await fetch("/api/agent-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, ...extras }),
      });
  
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
  
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) applyEvent(id, JSON.parse(line) as TeamEvent);
        }
      }
    } catch (err) {
      updateRun(id, (r) => ({
        ...r,
        error: err instanceof Error ? err.message : "Request failed",
      }));
    } finally {
      setBusy(false);
    }
  }
  
  function send() {
    const idea = input.trim();
    if (idea.length < 10) return;
    setInput("");
    startRun(idea, simulateFailure ? { fault: "incomplete_research" } : {});
  }
  
  function rerunWithChange(run: Run, change: string, rerunFrom: "researcher" | "strategist") {
    if (!run.research || !run.plan) return;
    startRun(run.idea, {
      update: { change, rerunFrom, previous: { research: run.research, plan: run.plan } },
    });
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col px-4">
        <header className="flex items-start justify-between py-5">
        <div>
            <h1 className="text-xl font-semibold">Startup Checker</h1>
            <p className="text-sm text-zinc-500">
            Describe a startup idea. A researcher, strategist and critic will work through it.
            </p>
        </div>

        <form
            action={signOutAction}
            className="flex items-center gap-3 text-sm text-zinc-500"
        >
            <span>{userName}</span>
            <button type="submit" className="underline">
            Sign out
            </button>
        </form>
        </header>

      <main className="flex-1 space-y-8 overflow-y-auto pb-4">
        {runs.length === 0 && (
          <p className="mt-16 text-center text-zinc-400">
            Try: “A subscription service that delivers pre-portioned ingredients for student flats.”
          </p>
        )}

        {runs.map((run) => (
          <RunView key={run.id} run={run} busy={busy} onUpdate={rerunWithChange} />
        ))}
        <div ref={bottomRef} />
      </main>

      {testMode && (
        <label className="flex items-center gap-2 pt-2 text-xs text-zinc-500">
            <input
            type="checkbox"
            checked={simulateFailure}
            onChange={(e) => setSimulateFailure(e.target.checked)}
            />
            Test: simulate researcher failure (empty research handoff)
        </label>
        )}
      <div className="flex items-end gap-2 border-t border-zinc-200 py-4 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="Describe your startup idea…  (Enter to send, Shift+Enter for a new line)"
          className="flex-1 resize-none rounded-lg border border-zinc-300 bg-transparent p-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-700"
        />
        <button
          onClick={send}
          disabled={busy || input.trim().length < 10}
          className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? "Running…" : "Check it"}
        </button>
      </div>
    </div>
  );
}

function RunView({
    run,
    busy,
    onUpdate,
  }: {
    run: Run;
    busy: boolean;
    onUpdate: (run: Run, change: string, rerunFrom: "researcher" | "strategist") => void;
  }) {
    return (
      <div className="space-y-4">
        <div className="ml-auto max-w-[85%] rounded-2xl bg-blue-600 px-4 py-3 text-sm text-white">
          {run.idea}
          {run.note && (
            <div className="mt-2 border-t border-white/30 pt-2 text-xs">{run.note}</div>
          )}
        </div>
  
        {AGENTS.map((a) => (
          <div
            key={a.key}
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium">{a.label}</span>
                <span className="ml-2 text-xs text-zinc-500">{a.role}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[run.status[a.key]]}`}>
                {run.status[a.key]}
              </span>
            </div>
  
            {a.key === "researcher" && run.research && (
              <>
                <ResearcherView data={run.research} />
                <RawJson data={run.research} label="Handoff to Strategist" />
              </>
            )}
            {a.key === "strategist" && run.plan && (
              <>
                <StrategistView data={run.plan} />
                <RawJson data={run.plan} label="Handoff to Critic" />
              </>
            )}
            {a.key === "critic" && run.review && (
              <>
                <CriticView data={run.review} />
                <RawJson data={run.review} label="Final result" />
              </>
            )}
          </div>
        ))}
  
        {run.review && !busy && <UpdateForm run={run} onSubmit={onUpdate} />}
  
        {run.error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {run.error}
          </p>
        )}
  
        {run.log.length > 0 && (
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer">Run log</summary>
            <pre className="mt-2 whitespace-pre-wrap">{run.log.join("\n")}</pre>
          </details>
        )}
      </div>
    );
  }

function UpdateForm({
    run, onSubmit,
  }: {
    run: Run;
    onSubmit: (run: Run, change: string, rerunFrom: "researcher" | "strategist") => void;
  }) {
    const [change, setChange] = useState("");
    const [rerunFrom, setRerunFrom] = useState<"researcher" | "strategist">("researcher");
  
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm dark:border-zinc-700">
        <div className="font-medium">A key fact changed</div>
        <input
          value={change}
          onChange={(e) => setChange(e.target.value)}
          placeholder="e.g. A well-funded competitor launched the same service in your city last month"
          className="w-full rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
        />
        <select
          value={rerunFrom}
          onChange={(e) => setRerunFrom(e.target.value as "researcher" | "strategist")}
          className="w-full rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
        >
          <option value="researcher">Market fact changed: rerun from Researcher</option>
          <option value="strategist">Constraint changed: rerun from Strategist</option>
        </select>
        <button
          onClick={() => onSubmit(run, change.trim(), rerunFrom)}
          disabled={change.trim().length < 5}
          className="rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-40"
        >
          Re-run team
        </button>
      </div>
    );
  }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SourceLink({ url, label = "source" }: { url: string; label?: string }) {
  if (!/^https?:\/\//.test(url)) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
      {label}
    </a>
  );
}

function MetricLine({ label, m }: { label: string; m: MetricT | null }) {
  return (
    <li>
      <span className="font-medium">{label}:</span>{" "}
      {m ? (
        <>
          {m.value.toLocaleString("en-US")} {m.unit}{" "}
          <span className="text-zinc-500">(as of {m.as_of})</span>{" "}
          <SourceLink url={m.source_url} />
          <div className="text-xs text-zinc-500">
            Counts: {m.definition}. “{m.evidence_quote}”
          </div>
        </>
      ) : (
        <span className="text-zinc-500">not established</span>
      )}
    </li>
  );
}

function ResearcherView({ data }: { data: ResearcherOutput }) {
  const { scope, parent_market: pm, target_segment: ts, bottom_up_estimate: est } = data;
  return (
    <div className="mt-3 text-sm">
      <p>{data.summary}</p>

      <Section title="Scope assumed">
        <p>
          {scope.geography} · {scope.segment}
        </p>
        {scope.assumptions.length > 0 && (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-zinc-500">
            {scope.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Parent market (context): ${pm.definition}`}>
        <ul className="space-y-2">
          <MetricLine label="Market size" m={pm.size} />
          <MetricLine label="Customers" m={pm.customers} />
        </ul>
      </Section>

      <Section title={`Target segment: ${ts.definition}`}>
        <ul className="space-y-2">
          <MetricLine label="People in segment" m={ts.customers} />
          <MetricLine label="Annual spend per person" m={ts.annual_spend_per_customer} />
        </ul>
        <p className="mt-2">
          {est ? (
            <>
              <span className="font-medium">Bottom-up ceiling:</span>{" "}
              {est.value.toLocaleString("en-US")} {est.unit}{" "}
              <span className="text-zinc-500">({est.formula})</span>
            </>
          ) : (
            <span className="text-zinc-500">No bottom-up estimate.</span>
          )}
        </p>
        <p className="mt-1 text-xs text-zinc-500">{data.estimate_note}</p>
        {ts.notes && <p className="mt-1 text-xs text-zinc-500">{ts.notes}</p>}
        {ts.searches_tried.length > 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            Searches tried: {ts.searches_tried.join(" · ")}
          </p>
        )}
      </Section>

      {data.competitors.length > 0 && (
        <Section title="Competitors">
          <ul className="list-disc space-y-1 pl-5">
            {data.competitors.map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.name}</span>: {c.offering}
                {c.price && <span> · {c.price}</span>} <SourceLink url={c.source_url} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Known">
        <ul className="list-disc space-y-1 pl-5">
          {data.knowns.map((k, i) => (
            <li key={i}>
              {k.fact}{" "}
              <span className="text-xs text-zinc-500">
                ({k.confidence} confidence · {k.source_type.replace(/_/g, " ")} · {k.as_of})
              </span>{" "}
              <SourceLink url={k.source_url} />
              <div className="text-xs text-zinc-500">“{k.evidence_quote}”</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Unknown">
        <ul className="list-disc space-y-1 pl-5">
          {data.unknowns.map((u, i) => (
            <li key={i}>
              {u.question} <span className="text-zinc-500">— {u.why_it_matters}</span>
            </li>
          ))}
        </ul>
      </Section>

      {data.sources.length > 0 && (
        <Section title="Sources">
          <ul className="list-disc space-y-1 pl-5">
            {data.sources.map((s, i) => (
              <li key={i}>
                {/^https?:\/\//.test(s.url) ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {s.title || s.url}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function RawJson({ data, label }: { data: unknown; label: string }) {
  return (
    <details className="mt-3 text-xs text-zinc-500">
      <summary className="cursor-pointer">{label}: raw JSON</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function StrategistView({ data }: { data: StrategistOutput }) {
    return (
      <div className="mt-3 text-sm">
        <p>{data.summary}</p>
  
        {data.research_limitations.length > 0 && (
          <Section title="Research limitations">
            <ul className="list-disc space-y-1 pl-5">
              {data.research_limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Section>
        )}
  
        {data.changes_from_previous.length > 0 && (
          <Section title="What changed from the previous plan">
            <ul className="list-disc space-y-1 pl-5">
              {data.changes_from_previous.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </Section>
        )}
  
        <Section title="Plan">
          <ol className="list-decimal space-y-1 pl-5">
            {data.steps.map((s, i) => (
              <li key={i}>
                {s.action} <span className="text-zinc-500">— {s.rationale}</span>
              </li>
            ))}
          </ol>
        </Section>
  
        <Section title="Assumptions">
          <ul className="list-disc space-y-1 pl-5">
            {data.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Section>
  
        <Section title="Success metric">
          <p>{data.success_metric}</p>
        </Section>
      </div>
    );
  }

const VERDICT_STYLE = {
  proceed: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  revise: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  reject: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
} as const;

function CriticView({ data }: { data: CriticOutput }) {
  return (
    <div className="mt-3 text-sm">
      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${VERDICT_STYLE[data.verdict]}`}>
        Verdict: {data.verdict}
      </span>
      <Section title="Issues">
        <ul className="space-y-1">
          {data.issues.map((issue, i) => (
            <li key={i}>
              <span className="text-xs font-semibold uppercase text-zinc-500">
                {issue.severity} · {issue.affects}
              </span>
              <br />
              {issue.issue}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Recommendation">
        <p>{data.recommendation}</p>
      </Section>
    </div>
  );
}