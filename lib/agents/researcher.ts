import { z } from "zod";
import { callAgent } from "../llm";

const MetricSchema = z.object({
  value: z.number(),
  unit: z.string().describe('e.g. "people" or "USD per year"'),
  definition: z.string().describe("What this figure counts, in the source's words"),
  basis: z
    .enum(["stated", "calculated"])
    .describe("stated = the figure appears on the page; calculated = you derived it"),
  evidence_quote: z
    .string()
    .describe("Exact words (under 25) from the page that contain the figure"),
  source_url: z.string(),
  as_of: z.string().describe("Year or date the figure refers to"),
});

const ResearcherModelSchema = z.object({
  summary: z
    .string()
    .describe(
      "2-3 plain-text sentences with the headline numbers and main conclusion. No markdown or links. Do not repeat the lists below."
    ),
  scope: z.object({
    geography: z.string().describe("One country or region, not a combination"),
    segment: z.string().describe("The specific people the idea serves"),
    assumptions: z
      .array(z.string())
      .describe(
        "Choices you made about geography or segment, each with the reason. Never describe calculations here."
      ),
  }),
  parent_market: z.object({
    definition: z.string(),
    size: MetricSchema.nullable(),
    customers: MetricSchema.nullable(),
  }),
  target_segment: z.object({
    definition: z.string(),
    customers: MetricSchema.nullable(),
    annual_spend_per_customer: MetricSchema.nullable(),
    searches_tried: z
      .array(z.string())
      .describe("The search queries you ran to find the segment figures"),
    notes: z.string(),
  }),
  competitors: z.array(
    z.object({
      name: z.string(),
      offering: z.string(),
      price: z.string().nullable(),
      evidence_quote: z
        .string()
        .nullable()
        .describe("Exact words from the page containing the price; null if price is null"),
      source_url: z.string(),
    })
  ),
  knowns: z.array(
    z.object({
      fact: z.string().describe("One figure or claim per entry"),
      confidence: z.enum(["low", "medium", "high"]),
      source_type: z.enum([
        "official_statistics",
        "industry_report",
        "company_self_reported",
        "aggregator",
        "news",
        "other",
      ]),
      evidence_quote: z
        .string()
        .describe("Exact words (under 25) from the page that support this fact"),
      source_url: z.string(),
      as_of: z.string(),
    })
  ),
  unknowns: z.array(z.object({ question: z.string(), why_it_matters: z.string() })),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

export const ResearcherOutputSchema = ResearcherModelSchema.extend({
  bottom_up_estimate: z
    .object({ value: z.number(), unit: z.string(), formula: z.string() })
    .nullable(),
  estimate_note: z.string(),
});

export type ResearcherOutput = z.infer<typeof ResearcherOutputSchema>;

const INSTRUCTIONS = `You are the Researcher on a startup-vetting team. Your output is the
evidence base a Strategist will build a plan from, so it must be quantitative,
sourced, and honest about gaps.

Two levels of market. Keep them separate:
- parent_market: the broad category. Context only. size and customers must
  describe the SAME geography and the SAME category. If no customers figure
  exists for that exact category and geography, set it to null.
- target_segment: the specific people the idea serves (for example, university
  students). customers and annual_spend_per_customer MUST describe this segment.
  A parent-market figure does not satisfy them. If you only found parent-market
  data, set the segment fields to null and add an unknown. Never put a
  parent-market number in a segment field.

Search plan. Run separate searches for each of:
1. size and growth of the parent market
2. the number of people in the exact target segment (official statistics where possible)
3. what one person in that segment spends per year in this category
4. competitors: include the CHEAPEST options you find, not only the best-known
   brands, because price sensitivity matters for the segment. Give each a price.
5. evidence on how the target customers behave (surveys, studies, churn)
6. regulation or other barriers, if relevant
Before you report a segment figure as unknown, run at least two differently
worded searches for it (official statistics first, then surveys or industry
data) and list the queries in target_segment.searches_tried.

Numbers.
- Every figure must be STATED on a page you retrieved. Put the exact words
  (under 25) containing the figure in evidence_quote. source_url must be the page
  where you saw it. Never attribute a figure to a page that does not contain it.
- NEVER calculate, divide, estimate or round into a figure. In particular, never
  derive spend per customer by dividing a market size by a customer count. If a
  figure is not stated anywhere you found, set it to null and add an unknown.
  The code does any multiplication.
- definition: what the figure counts, in the source's words.
- knowns: one figure or claim per entry, each with its own evidence_quote.
- Competitor prices: use the company's own pricing page where possible. Put the
  exact words containing the price in evidence_quote. If you cannot find a price
  on a page, set price and evidence_quote to null.
- Use one currency, and make annual_spend_per_customer an annual figure.
- Prefer primary sources: official statistics, filings, peer-reviewed research.
  A site that repeats other people's numbers is a lead, not a source: find the
  original page. If you cannot, use source_type aggregator.
- Prefer data from the last 3 years.

Confidence. The code caps it by source_type, so be honest:
- high: official statistics, audited filings, or peer-reviewed research only.
- medium: a named market-research report, or reputable news citing a primary dataset. Forecasts are medium at most.
- low: aggregator or affiliate sites, a company's claims about market size or demand, sources over 5 years old, or unsourced claims.
- A company's own site is valid evidence of what that company offers and charges.

Scope. geography is one country or region. If the idea states no country or
segment, choose the most likely reading (the idea's wording is a clue) and put
each choice, with the reason, in scope.assumptions. assumptions describe choices
only: never use them to describe a calculation.

Unknowns: what matters to the plan that you searched for and could not find.

Formatting: every field is plain text. No markdown, bold, or links. Citations go
only in source_url fields and the sources list.

If the idea contains an UPDATE, treat it as authoritative. Re-derive everything
with it in mind, and do not carry over any conclusion that depended on a fact
the update contradicts.`;

// ---------- code-level checks ----------

function stripMarkdown(text: string): string {
  return text
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("utm_source");
    return u.toString();
  } catch {
    return url;
  }
}

const SCALES: Record<string, number> = {
  thousand: 1e3, k: 1e3,
  million: 1e6, mn: 1e6, m: 1e6,
  billion: 1e9, bn: 1e9, b: 1e9,
  trillion: 1e12,
};

type Figure = { text: string; values: number[] };

function figuresIn(text: string): Figure[] {
  const out: Figure[] = [];
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion|bn|mn|k|m|b)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const base = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isNaN(base)) continue;
    const values = [base];
    if (m[2]) values.push(base * SCALES[m[2].toLowerCase()]);
    out.push({ text: m[0].trim(), values });
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 0.005;

const isYear = (f: Figure) =>
  f.values.length === 1 &&
  Number.isInteger(f.values[0]) &&
  f.values[0] >= 1900 &&
  f.values[0] <= 2100 &&
  !f.text.includes(",");

// Figures in the claim that do not appear in the quote (years are ignored)
function unsupportedFigures(claim: string, quote: string): string[] {
  const inQuote = figuresIn(quote).flatMap((f) => f.values);
  return figuresIn(claim)
    .filter((f) => !isYear(f))
    .filter((f) => !f.values.some((v) => inQuote.some((q) => close(q, v))))
    .map((f) => f.text);
}

function quoteSupportsValue(value: number, quote: string): boolean {
  return figuresIn(quote).some((f) => f.values.some((v) => close(v, value)));
}

type Metric = z.infer<typeof MetricSchema>;
type Known = z.infer<typeof ResearcherModelSchema>["knowns"][number];
type Problem = { label: string; reason: string };

function vetMetric(label: string, m: Metric | null, problems: Problem[]): Metric | null {
  if (!m) return null;
  if (m.basis === "calculated") {
    problems.push({ label, reason: "the model calculated this figure instead of finding it stated in a source" });
    return null;
  }
  if (!quoteSupportsValue(m.value, m.evidence_quote)) {
    problems.push({
      label,
      reason: `the figure ${m.value.toLocaleString("en-US")} does not appear in the quote cited for it`,
    });
    return null;
  }
  return { ...m, source_url: cleanUrl(m.source_url) };
}

function capConfidence(type: Known["source_type"], c: Known["confidence"]): Known["confidence"] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const max: Known["confidence"] =
    type === "official_statistics"
      ? "high"
      : type === "industry_report" || type === "news"
        ? "medium"
        : "low";
  return rank[c] > rank[max] ? max : c;
}

export async function runResearcher(idea: string): Promise<ResearcherOutput> {
  const r = await callAgent({
    name: "researcher_output",
    instructions: INSTRUCTIONS,
    input: `Startup idea: ${idea}`,
    schema: ResearcherModelSchema,
    tools: [{ type: "web_search", search_context_size: "high" }],
  });

  const problems: Problem[] = [];
  const parentSize = vetMetric("Parent market size", r.parent_market.size, problems);
  const parentCustomers = vetMetric("Parent market customers", r.parent_market.customers, problems);
  const segCustomers = vetMetric("Segment customers", r.target_segment.customers, problems);
  const segSpend = vetMetric("Segment annual spend per customer", r.target_segment.annual_spend_per_customer, problems);

  const competitors = r.competitors.map((c) => {
    let price = c.price;
    if (price) {
      const missing = unsupportedFigures(price, c.evidence_quote ?? "");
      if (missing.length > 0) {
        problems.push({
          label: `${c.name} price`,
          reason: `${missing.join(", ")} does not appear in the quote cited for it`,
        });
        price = null;
      }
    }
    return { ...c, price, source_url: cleanUrl(c.source_url) };
  });

  const knowns = r.knowns.map((k) => {
    const missing = unsupportedFigures(k.fact, k.evidence_quote);
    const unverified = missing.length > 0;
    return {
      ...k,
      fact:
        stripMarkdown(k.fact) +
        (unverified ? ` (unverified: ${missing.join(", ")} not found in the quoted text)` : ""),
      confidence: unverified ? ("low" as const) : capConfidence(k.source_type, k.confidence),
      source_url: cleanUrl(k.source_url),
    };
  });

  let estimate: ResearcherOutput["bottom_up_estimate"] = null;
  let estimateNote: string;
  if (segCustomers && segSpend) {
    estimate = {
      value: segCustomers.value * segSpend.value,
      unit: segSpend.unit,
      formula: `${segCustomers.value.toLocaleString("en-US")} ${segCustomers.unit} × ${segSpend.value.toLocaleString("en-US")} ${segSpend.unit}`,
    };
    estimateNote =
      "Ceiling: every person in the segment spending the full annual amount. Both inputs are stated in sources; the model did not calculate either.";
  } else {
    const missing = [
      !segCustomers && "segment customer count",
      !segSpend && "segment annual spend per customer",
    ]
      .filter(Boolean)
      .join(" and ");
    estimateNote = `Not computed: ${missing} not established. See unknowns.`;
  }

  return {
    ...r,
    summary: stripMarkdown(r.summary),
    parent_market: { ...r.parent_market, size: parentSize, customers: parentCustomers },
    target_segment: { ...r.target_segment, customers: segCustomers, annual_spend_per_customer: segSpend },
    competitors,
    knowns,
    unknowns: [
      ...r.unknowns,
      ...problems.map((p) => ({
        question: `Could not verify: ${p.label}`,
        why_it_matters: `Rejected because ${p.reason}. The plan should not rely on it until it is found stated in a source.`,
      })),
    ],
    sources: r.sources.map((s) => ({ ...s, url: cleanUrl(s.url) })),
    bottom_up_estimate: estimate,
    estimate_note: estimateNote,
  };
}