import { figure_format } from '#scripts/lib/figure-format'
import { shell_quote } from '#scripts/lib/shell-quote'
import type { CategoryCount } from '#scripts/review/review-finding-ledger'
import type { RoleTotals } from '#tools/cost/cost-run-roles'
import type { GuardRow } from './guard-friction'

// The digest's improvement picks, ranked here so the reader weighs an order rather than builds one. Each
// measurement that already marks friction becomes a candidate; candidates are ordered by tier (the
// kind of effect) and, within a tier, by the size the measurement already reports, so the top two are
// printed with the `issue:file` line that files them and the rest are named for the observation ledger.
//
// **The tiers rank effect, not certainty.** A cost regression is measured against the trend and names
// its own reproduction, so it leads; guard round trips are money the run spent being refused; a
// waiting-heavy role is wall clock lost; a recurring finding or ship stop is friction counted, not priced.
// Whether a pick passes the depth test is still the filer's (`observation-filing.md`).

const PICK_COUNT = 2
const PERCENT = 100
// A count seen once is a sighting, not a recurrence — the observation ledger's job, not a filing.
const MIN_RECURRENCE = 2
const COST_REGRESSION_PREFIX = 'File a cost regression: '
const REPRODUCTION_SEPARATOR = ' — reproduce with'

const TIER = { cost_regression: 0, guard: 1, waiting: 2, finding: 3, ship_stop: 4 } as const

interface Pick {
	title: string
	evidence: string
	tier: number
	weight: number
}

interface PickInputs {
	audit_summary: string
	guards: ReadonlyArray<GuardRow>
	waiting: ReadonlyArray<RoleTotals>
	findings: ReadonlyArray<CategoryCount>
	ship_stops: ReadonlyMap<string, number>
}

function cost_regression_picks(audit_summary: string): Array<Pick> {
	const line = audit_summary.split('\n').find((entry) => entry.startsWith(COST_REGRESSION_PREFIX))

	if (line === undefined) return []

	// The rows go to the evidence, not the title: a wide regression names a dozen of them.
	const rows = line.slice(COST_REGRESSION_PREFIX.length).split(REPRODUCTION_SEPARATOR)[0] ?? ''
	const title = `Fix cost regression in ${String(rows.split(', ').length)} cost:audit row(s)`

	return [{ title, evidence: line, tier: TIER.cost_regression, weight: 0 }]
}

function guard_pick(row: GuardRow): Pick {
	const evidence = `${String(row.refusals)} refused, ${String(row.stops)} stopped, ${figure_format.format_usd(row.usd)}`

	return {
		title: `Reduce ${row.guard} guard friction`,
		evidence,
		tier: TIER.guard,
		weight: row.usd,
	}
}

function waiting_pick(role: RoleTotals): Pick {
	const gap = role.elapsed_share - role.cost_share
	const evidence = `time share ${String(Math.round(gap * PERCENT))} points ahead of cost share`

	return { title: `Cut ${role.role} waiting time`, evidence, tier: TIER.waiting, weight: gap }
}

function finding_pick(entry: CategoryCount): Pick {
	return {
		title: `Prevent recurring ${entry.category} review findings`,
		evidence: `${String(entry.count)} finding(s)`,
		tier: TIER.finding,
		weight: entry.count,
	}
}

function ship_stop_pick(reason: string, count: number): Pick {
	const evidence = `${String(count)} stop(s)`

	return { title: `Reduce ship stops at ${reason}`, evidence, tier: TIER.ship_stop, weight: count }
}

function recurring_picks(inputs: PickInputs): Array<Pick> {
	const findings = inputs.findings.filter((entry) => entry.count >= MIN_RECURRENCE)
	const stops = [...inputs.ship_stops].filter(([, count]) => count >= MIN_RECURRENCE)

	return [
		...findings.map((entry) => finding_pick(entry)),
		...stops.map(([reason, count]) => ship_stop_pick(reason, count)),
	]
}

function candidates(inputs: PickInputs): Array<Pick> {
	return [
		...cost_regression_picks(inputs.audit_summary),
		...inputs.guards.map((row) => guard_pick(row)),
		...inputs.waiting.map((role) => waiting_pick(role)),
		...recurring_picks(inputs),
	]
}

function rank(inputs: PickInputs): Array<Pick> {
	return candidates(inputs).toSorted(
		(left, right) => left.tier - right.tier || right.weight - left.weight,
	)
}

function filing_lines(pick: Pick, index: number): Array<string> {
	return [
		`  ${String(index + 1)}. ${pick.title} — ${pick.evidence}`,
		`     pnpm josh issue:file ${shell_quote.single_quoted(pick.title)} --body-file <body.md>`,
	]
}

// The top two with their filing line, the rest one stack line each — the split `retrospective.md`
// files by.
function report_lines(inputs: PickInputs): Array<string> {
	const ranked = rank(inputs)

	if (ranked.length === 0) return ['Improvement picks: none']

	const filed = ranked.slice(0, PICK_COUNT).flatMap((pick, index) => filing_lines(pick, index))
	const stacked = ranked
		.slice(PICK_COUNT)
		.map((pick) => `  stack: ${pick.title} — ${pick.evidence}`)

	return ['Improvement picks (ranked by effect):', ...filed, ...stacked]
}

const retrospective_picks = { rank, report_lines }

export type { Pick, PickInputs }
export { retrospective_picks }
