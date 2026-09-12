import { cost_cli } from '#scripts/cost/cost-cli'
import type { AttributedRecord } from '#scripts/cost/cost-corpus'
import { cost_pricing } from '#scripts/cost/cost-pricing'
import { cost_usage, type UsageRecord } from '#scripts/cost/cost-usage'
import type { DelegatedUnit } from './time-delegated-cost'
import type { PricedRequest } from './time-phase-costs'
import type { RunSources } from './time-run'

// One issue's cost corpus, read once for the two things the run report attributes from
// (joshuafolkken/kit#1606, joshuafolkken/kit#1882): each billed request as an instant and a price for
// the phase attribution, and each delegated unit's resident baseline for the launch-cost block.
//
// **It reuses `josh cost`'s own attribution rather than repeating it.** Which session's requests
// belong to which issue is decided by `cost_cli.attributed`, the same walk `pnpm josh cost --issue`
// reports from, so the dollar total printed beside the phases cannot drift from the one the cost
// command prints for the same run — and a delegated unit is followed to the issue its parent named,
// exactly as that command follows it.
//
// **The walk happens once, and that is the whole reason both readings come out of one reader.**
// Loading the corpus walks every transcript in the checkout — 669 files and 296 MB when the span
// collector was last measured — so a second reader for the launch costs would pay that walk a second
// time. `--issue` and the latest-run path opt in through `time_run.RUN_COST_SOURCES`; the epic,
// last-N and history paths do not, and their reports say the corpus was not read rather than
// reporting zero.
//
// **An unpriced model contributes no dollars, and the request says so rather than reporting a zero.**
// The pricing table cannot cost a model it does not know — the same treatment `cost_pricing.total_cost`
// gives it — so `is_priced` rides along and the blocks above their totals print how many were left
// out, which makes those totals floors rather than figures nobody can check.

const NO_COST = 0
const NO_TOKENS = 0

function to_priced(record: UsageRecord): PricedRequest {
	const price = cost_pricing.resolve_price(record.model)

	return {
		at_ms: record.at_ms,
		cost_usd: price === undefined ? NO_COST : cost_pricing.estimate_cost(record.totals, price),
		is_priced: price !== undefined,
	}
}

// The fallback price for a session with no record to cost. Its own records are non-empty by
// construction, so this stands only to satisfy the read; it is never the answer on a real corpus.
function to_priced_none(): PricedRequest {
	return { at_ms: undefined, cost_usd: NO_COST, is_priced: false }
}

function attributed_for(cwd: string, issue_number: number): Array<AttributedRecord> {
	return cost_cli
		.attributed(cost_cli.load_corpus(cwd))
		.filter((pair) => pair.issue === issue_number)
}

// The delegated sessions this issue's records came from, each session's records kept together so its
// context-construction request can be found among them.
function delegated_by_session(
	attributed: ReadonlyArray<AttributedRecord>,
): Map<string, Array<AttributedRecord>> {
	const groups = new Map<string, Array<AttributedRecord>>()

	for (const pair of attributed) {
		if (!pair.is_delegated) continue

		groups.set(pair.session_id, [...(groups.get(pair.session_id) ?? []), pair])
	}

	return groups
}

// One delegated unit's launch cost. `baseline_tokens` is the billed input of the session's first
// request, so the record whose billed input equals it *is* that context-construction request — priced
// by the same `to_priced` a phase request is, so the two dollar figures cannot drift. Its own records
// are non-empty by construction; the `records[0]` fallback is what `noUncheckedIndexedAccess` asks of
// the read rather than a state that can occur.
function unit_of(session_id: string, records: ReadonlyArray<AttributedRecord>): DelegatedUnit {
	const baseline = records[0]?.baseline_tokens ?? NO_TOKENS
	const found = records.find((pair) => cost_usage.billed_input(pair.record.totals) === baseline)
	const construction = found ?? records[0]
	const priced = construction === undefined ? to_priced_none() : to_priced(construction.record)

	return {
		session_id,
		baseline_tokens: baseline,
		cost_usd: priced.cost_usd,
		is_priced: priced.is_priced,
	}
}

function delegated_units(attributed: ReadonlyArray<AttributedRecord>): Array<DelegatedUnit> {
	return [...delegated_by_session(attributed)].map(([session_id, records]) =>
		unit_of(session_id, records),
	)
}

// Both projections of one issue's cost corpus, so the reader is walked once and the phase costs and
// the launch costs cannot disagree about which requests belonged to the run.
interface RunCostReading {
	priced: ReadonlyArray<PricedRequest>
	units: ReadonlyArray<DelegatedUnit>
}

function run_cost_for(cwd: string, issue_number: number): RunCostReading {
	const attributed = attributed_for(cwd, issue_number)

	return {
		priced: attributed.map((pair) => to_priced(pair.record)),
		units: delegated_units(attributed),
	}
}

// What the two single-run paths hand `time_run` — the only scopes for which one corpus walk is one
// walk. It sits here rather than beside `NO_SOURCES` so `time-run.ts` never imports the walk itself;
// the type comes back the other way, which is a type-only edge and no cycle at runtime.
const RUN_COST_SOURCES: RunSources = {
	found: undefined,
	search: undefined,
	cost_of: run_cost_for,
}

// How `time-run.ts` asks a source set for its costs. It reads the optional reader here rather than at
// the two call sites so neither of them carries the extra branch, and the type travels with the reader
// it describes.
type RunCostReader = (cwd: string, issue_number: number) => RunCostReading

function reading_for(
	sources: RunSources,
	cwd: string,
	issue_number: number,
): RunCostReading | undefined {
	return sources.cost_of?.(cwd, issue_number)
}

const time_request_costs = {
	RUN_COST_SOURCES,
	to_priced,
	run_cost_for,
	reading_for,
	delegated_units,
}

export type { RunCostReader, RunCostReading }
export { time_request_costs }
