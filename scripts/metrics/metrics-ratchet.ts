import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { Metrics } from './metrics-logic'

// The ratchet over `josh metrics`' totals. Measuring a slow growth does not
// stop it, so the gate compares the totals against the recorded baseline: **a total that grew fails
// the gate, a total that shrank moves the baseline down**, and the only way up is an explicit
// `--accept` with a reason, recorded beside the values it raised.
//
// **No tolerance on these totals.** They are counts read off the tree, so the same tree always
// produces the same values — any increase is a real one.
//
// **Only the totals the ratchet is about are compared** — code lines, the comment ratio, the
// rule-document lines, the guard count and the two AI-cost byte totals. A
// file count or a comment-line count moves with them and would only state the same growth twice.

const NEWLINE = '\n'

const baseline_schema = z.object({
	scripts: z.object({
		files: z.number(),
		code_lines: z.number(),
		comment_lines: z.number(),
		comment_ratio: z.number(),
	}),
	rules: z.object({ files: z.number(), lines: z.number() }),
	guards: z.number(),
	ai_cost: z.object({ resident_bytes: z.number(), on_demand_bytes: z.number() }),
	accepted: z.object({ reason: z.string(), date: z.string() }).optional(),
})

type Baseline = z.infer<typeof baseline_schema>

interface Change {
	name: string
	baseline: number
	current: number
}

type Verdict =
	| { kind: 'regressed'; regressions: ReadonlyArray<Change> }
	| { kind: 'improved'; baseline: Baseline }
	| { kind: 'unchanged' }

function parse_baseline(text: string): Baseline | undefined {
	const parsed = baseline_schema.safeParse(json_value.parse_or_undefined(text))

	return parsed.success ? parsed.data : undefined
}

function ratcheted(metrics: Metrics): ReadonlyArray<[string, number]> {
	return [
		['scripts.code_lines', metrics.scripts.code_lines],
		['scripts.comment_ratio', metrics.scripts.comment_ratio],
		['rules.lines', metrics.rules.lines],
		['guards', metrics.guards],
		['ai_cost.resident_bytes', metrics.ai_cost.resident_bytes],
		['ai_cost.on_demand_bytes', metrics.ai_cost.on_demand_bytes],
	]
}

function changes(baseline: Metrics, current: Metrics): ReadonlyArray<Change> {
	const before = new Map(ratcheted(baseline))

	return ratcheted(current)
		.map(([name, value]) => ({ name, baseline: before.get(name) ?? value, current: value }))
		.filter((change) => change.current !== change.baseline)
}

// The improved baseline carries every current value, not only the compared ones, so the file
// always describes one tree. The last accepted reason stays: it is the record of the last raise.
function lowered(baseline: Baseline, current: Metrics): Baseline {
	return baseline.accepted === undefined ? current : { ...current, accepted: baseline.accepted }
}

function compare(baseline: Baseline, current: Metrics): Verdict {
	const changed = changes(baseline, current)
	const regressions = changed.filter((change) => change.current > change.baseline)

	if (regressions.length > 0) return { kind: 'regressed', regressions }
	if (changed.length === 0) return { kind: 'unchanged' }

	return { kind: 'improved', baseline: lowered(baseline, current) }
}

function accept(current: Metrics, reason: string, date: string): Baseline {
	return { ...current, accepted: { reason, date } }
}

function render_regressions(regressions: ReadonlyArray<Change>, baseline_path: string): string {
	return [
		`josh metrics: ${String(regressions.length)} total(s) grew past the baseline in ${baseline_path}:`,
		...regressions.map(
			(change) =>
				`  ${change.name}  baseline ${String(change.baseline)} → current ${String(change.current)}`,
		),
		'Bring them back down, or raise the baseline with the reason it grew: pnpm josh metrics --accept --reason "<why>"',
	].join(NEWLINE)
}

const metrics_ratchet = {
	accept,
	compare,
	parse_baseline,
	render_regressions,
}

export type { Baseline, Change, Verdict }
export { metrics_ratchet }
