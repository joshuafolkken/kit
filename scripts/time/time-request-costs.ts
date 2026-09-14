import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import type { AttributedRecord, Corpus } from '#scripts/cost-runtime/cost-corpus'
import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import type { DelegatedUnit } from './time-delegated-cost'
import type { PricedRequest } from './time-phase-costs'
import type { RunSources } from './time-run'
import { time_unit_purpose, type UnitPurpose } from './time-unit-purpose'

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

function attributed_for(corpus: Corpus, issue_number: number): Array<AttributedRecord> {
	return cost_cli.attributed(corpus).filter((pair) => pair.issue === issue_number)
}

// A delegated unit's own transcript, for reading what it was launched to do (joshuafolkken/kit#1912).
// Found by session id among the corpus files already loaded, so no second directory walk; a unit whose
// file is not among them reads as unknown purpose rather than failing the whole read.
function raw_of_session(corpus: Corpus, session_id: string): string | undefined {
	const file = corpus.files.find((one) => one.session_id === session_id)

	return file === undefined ? undefined : cost_transcript.read_raw(file)
}

function purpose_of(raw: string | undefined): UnitPurpose {
	return raw === undefined ? time_unit_purpose.UNKNOWN_PURPOSE : time_unit_purpose.classify(raw)
}

function model_of(construction: AttributedRecord | undefined): string {
	return construction?.record.model ?? cost_usage.UNKNOWN_MODEL
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
function construction_of(
	records: ReadonlyArray<AttributedRecord>,
	baseline: number,
): AttributedRecord | undefined {
	const found = records.find((pair) => cost_usage.billed_input(pair.record.totals) === baseline)

	return found ?? records[0]
}

function unit_of(
	session_id: string,
	records: ReadonlyArray<AttributedRecord>,
	corpus: Corpus,
): DelegatedUnit {
	const baseline = records[0]?.baseline_tokens ?? NO_TOKENS
	const construction = construction_of(records, baseline)
	const priced = construction === undefined ? to_priced_none() : to_priced(construction.record)

	return {
		session_id,
		baseline_tokens: baseline,
		cost_usd: priced.cost_usd,
		is_priced: priced.is_priced,
		model: model_of(construction),
		purpose: purpose_of(raw_of_session(corpus, session_id)),
	}
}

function delegated_units(
	attributed: ReadonlyArray<AttributedRecord>,
	corpus: Corpus,
): Array<DelegatedUnit> {
	return [...delegated_by_session(attributed)].map(([session_id, records]) =>
		unit_of(session_id, records, corpus),
	)
}

// One session's requests, projected to just the token facts the per-session signals join against
// (joshuafolkken/kit#1970): the billed input as the context size, the output tokens, and the instant
// the request completed. Sorted oldest first, so a lookup by instant can take the nearest.
interface RequestTokens {
	at_ms: number | undefined
	billed_input: number
	output_tokens: number
}

interface SessionRequests {
	session_id: string
	requests: ReadonlyArray<RequestTokens>
}

function to_request_tokens(record: UsageRecord): RequestTokens {
	return {
		at_ms: record.at_ms,
		billed_input: cost_usage.billed_input(record.totals),
		output_tokens: record.totals.output_tokens,
	}
}

// The same attributed records grouped by their session, reusing this reader's one corpus walk rather
// than reading the attribution a second time (joshuafolkken/kit#1970). `time-session-signals.ts` joins
// these against the time-side spans.
function session_requests_of(attributed: ReadonlyArray<AttributedRecord>): Array<SessionRequests> {
	const groups = new Map<string, Array<RequestTokens>>()

	for (const pair of attributed) {
		const requests = groups.get(pair.session_id) ?? []

		requests.push(to_request_tokens(pair.record))
		groups.set(pair.session_id, requests)
	}

	return [...groups].map(([session_id, requests]) => ({
		session_id,
		requests: requests.toSorted(
			(left, right) => (left.at_ms ?? NO_TOKENS) - (right.at_ms ?? NO_TOKENS),
		),
	}))
}

// Both projections of one issue's cost corpus, so the reader is walked once and the phase costs and
// the launch costs cannot disagree about which requests belonged to the run.
interface RunCostReading {
	priced: ReadonlyArray<PricedRequest>
	units: ReadonlyArray<DelegatedUnit>
	session_requests: ReadonlyArray<SessionRequests>
}

function run_cost_for(cwd: string, issue_number: number): RunCostReading {
	const corpus = cost_cli.load_corpus(cwd)
	const attributed = attributed_for(corpus, issue_number)

	return {
		priced: attributed.map((pair) => to_priced(pair.record)),
		units: delegated_units(attributed, corpus),
		session_requests: session_requests_of(attributed),
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

export type { RequestTokens, RunCostReader, RunCostReading, SessionRequests }
export { time_request_costs }
