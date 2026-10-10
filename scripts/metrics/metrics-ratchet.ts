import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { Metrics } from './metrics-logic'

// The ratchet over `josh metrics`' totals. Measuring a slow growth does not stop it, so the gate
// compares the totals against the same totals measured on the merge-base: **a total that grew fails
// the gate**, and the only way past it is an explicit `--accept` with a reason, recorded in a file of
// the issue's own.
//
// **Nothing is compared against a recorded total.** A tracked baseline was rewritten by nearly every
// pull request — a raise by the one that added code, a lowering by the one that removed it — so two
// pull requests touching unrelated sources conflicted on it. The merge-base is a total nobody writes:
// a total that shrank is simply what the next branch is measured from.
//
// **An approval records the growth, not the total it reached.** Merging the default branch in moves
// both sides of the comparison by whatever landed there, so the growth stays this branch's own while
// an absolute total would be overtaken by somebody else's change.
//
// **Only an approval this branch wrote counts.** One the merge-base already holds, unchanged,
// approved an earlier branch's growth and says nothing about this one's.
//
// **No tolerance on these totals.** They are counts read off the tree, so the same tree always
// produces the same values — any increase is a real one.
//
// **Only the totals the ratchet is about are compared** — code lines, the comment ratio, the
// rule-document lines, the guard count and the two AI-cost byte totals. A
// file count or a comment-line count moves with them and would only state the same growth twice.

const NEWLINE = '\n'
const JSON_INDENT = '\t'
// The comment ratio is a two-decimal value, and a float subtraction of two of them is not.
const GROWTH_PRECISION = 100

const metrics_schema = z.object({
	scripts: z.object({
		files: z.number(),
		code_lines: z.number(),
		comment_lines: z.number(),
		comment_ratio: z.number(),
	}),
	rules: z.object({ files: z.number(), lines: z.number() }),
	guards: z.number(),
	ai_cost: z.object({ resident_bytes: z.number(), on_demand_bytes: z.number() }),
})

const approval_schema = z.object({
	reason: z.string(),
	date: z.string(),
	growth: z.record(z.string(), z.number()),
})

type Approval = z.infer<typeof approval_schema>

interface Change {
	name: string
	base: number
	current: number
	growth: number
	approved: number
}

type Verdict =
	| { kind: 'regressed'; regressions: ReadonlyArray<Change> }
	| { kind: 'approved' | 'shrank' | 'unchanged' }

function parse_metrics(text: string): Metrics | undefined {
	const parsed = metrics_schema.safeParse(json_value.parse_or_undefined(text))

	return parsed.success ? parsed.data : undefined
}

function parse_approval(text: string): Approval | undefined {
	const parsed = approval_schema.safeParse(json_value.parse_or_undefined(text))

	return parsed.success ? parsed.data : undefined
}

function approval_text(approval: Approval): string {
	return `${JSON.stringify(approval, undefined, JSON_INDENT)}${NEWLINE}`
}

// The approvals this branch wrote, out of every approval file by name: one whose text the merge-base
// does not hold. A file that does not parse approves nothing.
function fresh_approvals(
	current: ReadonlyMap<string, string>,
	base: ReadonlyMap<string, string>,
): ReadonlyArray<Approval> {
	return [...current]
		.filter(([name, text]) => base.get(name) !== text)
		.flatMap(([, text]) => parse_approval(text) ?? [])
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

function growth_between(base: number, current: number): number {
	return Math.round((current - base) * GROWTH_PRECISION) / GROWTH_PRECISION
}

function approved_growth(approvals: ReadonlyArray<Approval>, name: string): number {
	return Math.max(0, ...approvals.map((approval) => approval.growth[name] ?? 0))
}

function changes(
	base: Metrics,
	current: Metrics,
	approvals: ReadonlyArray<Approval>,
): ReadonlyArray<Change> {
	const before = new Map(ratcheted(base))

	return ratcheted(current)
		.map(([name, value]) => {
			const base_value = before.get(name) ?? value
			const growth = growth_between(base_value, value)

			return { name, base: base_value, current: value, growth }
		})
		.filter((change) => change.growth !== 0)
		.map((change) => ({ ...change, approved: approved_growth(approvals, change.name) }))
}

function settled_kind(changed: number, grown: number): 'approved' | 'shrank' | 'unchanged' {
	if (grown > 0) return 'approved'

	return changed > 0 ? 'shrank' : 'unchanged'
}

function compare(base: Metrics, current: Metrics, approvals: ReadonlyArray<Approval>): Verdict {
	const changed = changes(base, current, approvals)
	const grown = changed.filter((change) => change.growth > 0)
	const regressions = grown.filter((change) => change.growth > change.approved)

	if (regressions.length > 0) return { kind: 'regressed', regressions }

	return { kind: settled_kind(changed.length, grown.length) }
}

// The approval of what grew, or `undefined` when nothing did — there is no growth to record a reason
// for, and an empty approval would be a file every later reader has to see through.
function accept(
	base: Metrics,
	current: Metrics,
	reason: string,
	date: string,
): Approval | undefined {
	const grown = changes(base, current, []).filter((change) => change.growth > 0)

	if (grown.length === 0) return undefined

	return {
		reason,
		date,
		growth: Object.fromEntries(grown.map((change) => [change.name, change.growth])),
	}
}

function render_regression(change: Change): string {
	const values = `merge-base ${String(change.base)} → current ${String(change.current)}`

	return `  ${change.name}  ${values} (+${String(change.growth)}, approved +${String(change.approved)})`
}

function render_regressions(regressions: ReadonlyArray<Change>, commit: string): string {
	return [
		`josh metrics: ${String(regressions.length)} total(s) grew past the merge-base ${commit}:`,
		...regressions.map((change) => render_regression(change)),
		'Bring them back down, or record the reason they grew: pnpm josh metrics --accept --reason "<why>"',
	].join(NEWLINE)
}

const metrics_ratchet = {
	accept,
	approval_text,
	compare,
	fresh_approvals,
	parse_approval,
	parse_metrics,
	render_regressions,
}

export type { Approval, Change, Verdict }
export { metrics_ratchet }
