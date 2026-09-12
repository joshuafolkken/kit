import { time_format } from './time-format'

// What launching each delegated subagent cost, and what one launch's fixed context construction came
// to (joshuafolkken/kit#1882).
//
// **Delegation is not free parallelization.** Every subagent starts from an empty context, so its
// first request writes the whole resident prefix into cache before it does any work — 549k tokens
// across five units in one measured run, 44% of the run's subagent bill, about $1.1 a launch. A step
// is only worth delegating when its own work exceeds that fixed cost, and nothing in the run report
// said what the cost was. `josh cost --session <id>/agent-<id>` reads one unit at a time; this is the
// run-scoped sum the ranking in the diag skill needs.
//
// **The token count is the session's resident baseline, and the dollar figure prices its
// construction request** — the two the reader hands over already computed, so this module never
// touches the cost corpus. It is the shape `time-phase-costs.ts` has: a pure builder over records the
// reader priced, and a renderer, so a scope that did not read the corpus carries `is_measured: false`
// rather than a run reported as launching subagents for nothing.
//
// **A unit on a model the price table does not carry contributes a token count and no dollars**, and
// `is_priced` rides on it for the same reason it rides on a phase cost: without the flag the block
// would read every launch on an unpriced model as free, the confident zero this whole reading is
// written against.

const NONE = 0
const NO_COST = 0
const NO_UNITS = 0
const COST_DECIMALS = 2
// A delegated session id is long; the row shows enough of it to tell two units apart and lets
// `format_columns` keep the dollar column where the phase block put it.
const SESSION_LABEL_MAX = 22
const ELLIPSIS = '…'

// One delegated unit, reduced to what the block reports: which session it was, how many tokens its
// context construction billed, and what that cost. The reader fills these; the builder only sums them.
interface DelegatedUnit {
	session_id: string
	baseline_tokens: number
	cost_usd: number
	is_priced: boolean
}

// **`is_measured: false` is not "no subagent ran".** The batch scopes and the history recorder do not
// read the cost corpus at all, so their reports carry this record with every figure at zero and the
// flag off; a reader that took those zeros for a measurement would rank delegation as free. Same
// distinction the phase costs' own `is_measured` makes.
interface DelegatedCostFacts {
	units: ReadonlyArray<DelegatedUnit>
	unit_count: number
	baseline_tokens: number
	cost_usd: number
	per_unit_tokens: number
	per_unit_cost_usd: number
	// How many of the units above the price table could not cost. Non-zero makes `cost_usd` a floor
	// rather than the run's launch cost, and the block says so in words.
	unpriced_unit_count: number
	is_measured: boolean
}

function unmeasured(): DelegatedCostFacts {
	return {
		units: [],
		unit_count: NONE,
		baseline_tokens: NONE,
		cost_usd: NO_COST,
		per_unit_tokens: NONE,
		per_unit_cost_usd: NO_COST,
		unpriced_unit_count: NONE,
		is_measured: false,
	}
}

function per_unit(total: number, count: number): number {
	return count === NO_UNITS ? NONE : total / count
}

function sum_of(units: ReadonlyArray<DelegatedUnit>, of: (unit: DelegatedUnit) => number): number {
	return units.reduce((total, unit) => total + of(unit), NONE)
}

// Most expensive launch first, so the row a reader acts on is the one at the top — the same order the
// per-tool and per-command tables are read in.
function build(units: ReadonlyArray<DelegatedUnit> | undefined): DelegatedCostFacts {
	if (units === undefined) return unmeasured()

	const sorted = [...units].toSorted((left, right) => right.cost_usd - left.cost_usd)
	const unit_count = sorted.length
	const baseline_tokens = sum_of(sorted, (unit) => unit.baseline_tokens)
	const cost_usd = sum_of(sorted, (unit) => unit.cost_usd)

	return {
		units: sorted,
		unit_count,
		baseline_tokens,
		cost_usd,
		per_unit_tokens: Math.round(per_unit(baseline_tokens, unit_count)),
		per_unit_cost_usd: per_unit(cost_usd, unit_count),
		unpriced_unit_count: sorted.filter((unit) => !unit.is_priced).length,
		is_measured: true,
	}
}

const HEADING = 'What each subagent cost to launch:'
const TOTAL_LABEL = 'launch total'
const PER_UNIT_LABEL = 'per subagent'
const NONE_NOTE = 'no delegated subagent ran'
const NOT_MEASURED_NOTE = 'the cost corpus was not read for this scope'
const CONSTRUCTION_NOTE = 'resident context construction'
const UNPRICED_LABEL = 'unpriced subagents'
const UNPRICED_NOTE =
	'on a model the price table does not carry · the launch total above is a floor'

function tokens_text(count: number): string {
	return `${String(count)} tokens`
}

function session_label(session_id: string): string {
	if (session_id.length <= SESSION_LABEL_MAX) return session_id

	return `${session_id.slice(NONE, SESSION_LABEL_MAX - 1)}${ELLIPSIS}`
}

function unit_line(unit: DelegatedUnit): string {
	const cost = time_format.usd(unit.cost_usd, COST_DECIMALS)

	return time_format.format_columns(
		session_label(unit.session_id),
		cost,
		tokens_text(unit.baseline_tokens),
	)
}

function total_line(facts: DelegatedCostFacts): string {
	const subagents = `${String(facts.unit_count)} subagent(s)`
	const suffix = [subagents, tokens_text(facts.baseline_tokens)].join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_columns(
		TOTAL_LABEL,
		time_format.usd(facts.cost_usd, COST_DECIMALS),
		suffix,
	)
}

function per_unit_line(facts: DelegatedCostFacts): string {
	const cost = time_format.usd(facts.per_unit_cost_usd, COST_DECIMALS)
	const suffix = [tokens_text(facts.per_unit_tokens), CONSTRUCTION_NOTE].join(
		time_format.SUFFIX_SEPARATOR,
	)

	return time_format.format_columns(PER_UNIT_LABEL, cost, suffix)
}

// Printed only where there is something to say: a run whose every unit was priced carries no such row.
function unpriced_lines(facts: DelegatedCostFacts): Array<string> {
	if (facts.unpriced_unit_count === NONE) return []

	const count = time_format.format_columns(UNPRICED_LABEL, String(facts.unpriced_unit_count), '')

	return [`${count.trimEnd()}${time_format.SUFFIX_SEPARATOR}${UNPRICED_NOTE}`]
}

// A measured run with no delegated unit is a real answer — the work was done in the main line — so it
// says so rather than printing nothing, the same way the phase block prints its heading over an empty
// read.
function measured_lines(facts: DelegatedCostFacts): Array<string> {
	if (facts.unit_count === NONE) {
		return [
			time_format.format_columns(TOTAL_LABEL, time_format.usd(NO_COST, COST_DECIMALS), NONE_NOTE),
		]
	}

	return [
		...facts.units.map((one) => unit_line(one)),
		total_line(facts),
		per_unit_line(facts),
		...unpriced_lines(facts),
	]
}

// Nothing at all where the scope never carried the record, so the session, epic and period reports
// print exactly what they printed before. A scope that asked and found no delegated unit still prints
// the block, saying so in words.
function cost_lines(facts: DelegatedCostFacts | undefined): Array<string> {
	if (facts === undefined) return []

	if (!facts.is_measured) {
		return ['', HEADING, time_format.format_columns(TOTAL_LABEL, '', NOT_MEASURED_NOTE)]
	}

	return ['', HEADING, ...measured_lines(facts)]
}

const time_delegated_cost = {
	HEADING,
	TOTAL_LABEL,
	PER_UNIT_LABEL,
	NONE_NOTE,
	NOT_MEASURED_NOTE,
	CONSTRUCTION_NOTE,
	UNPRICED_LABEL,
	UNPRICED_NOTE,
	build,
	cost_lines,
}

export type { DelegatedCostFacts, DelegatedUnit }
export { time_delegated_cost }
