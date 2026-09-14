import { cost_dollar_composition, type DollarComposition } from './cost-dollar-composition'
import { cost_format } from './cost-format'
import { cost_output_turns, type OutputTurns } from './cost-output-turns'
import { cost_pricing } from './cost-pricing'
import { cost_session_metrics, type SessionMetrics } from './cost-session-metrics'
import { cost_usage, type UsageRecord } from './cost-usage'

// One issue's cost broken down by the main-line session it was spent in (joshuafolkken/kit#1912).
//
// A run that stopped once and resumed spans two sessions, and the run total hid which of them cost
// what — a hand measurement of `fullrun #1876` found the *stopped* first session was 76% of the run,
// which no figure in the report could show. This is that axis: one row per main-line session, each
// with its own request count, output tokens, dollars (with and without the units it spawned), the
// per-type dollar split, and the large-output distribution.
//
// **Delegated units are not sessions here** — they are attributed to the main-line session that
// spawned them, which is the `<parent>/agent-<id>` prefix of their own id, so `cost_usd_with_delegated`
// answers "what did this session cost me, subagents included" while `cost_usd` answers "what did its
// own turns cost". A unit whose owner is not among these sessions falls only into the run-wide
// delegated total, never invented into a session that is not here.

const NO_COST = 0
const FIRST = 0

// The fields of an attributed record this axis reads — declared here rather than imported from
// `cost-corpus`, so `cost-report.ts` can carry a `by_session` field without a type cycle back through
// the corpus, which imports `MissingData` from the report. An `AttributedRecord` satisfies it.
interface SessionRecord {
	record: UsageRecord
	baseline_tokens: number
	session_id: string
	is_delegated: boolean
}

interface SessionCost {
	session_id: string
	// Not the first main-line session in time order — the run was resumed into it. Its `preamble_tokens`
	// is the resume cost: the context it had to re-establish before doing any work.
	is_resumed: boolean
	request_count: number
	output_tokens: number
	cost_usd: number
	cost_usd_with_delegated: number
	composition: DollarComposition
	output_turns: OutputTurns
	// The billed input of the session's first request — the resident preamble it opened with. For a
	// resumed session this is what re-reading the whole prior context cost before the first new turn.
	preamble_tokens: number
	// The session's model, thinking-share and context-size figures (joshuafolkken/kit#1969).
	metrics: SessionMetrics
}

interface SessionGroup {
	session_id: string
	records: Array<UsageRecord>
	baseline: number
}

function cost_of(records: ReadonlyArray<UsageRecord>): number {
	return cost_pricing.total_cost(cost_pricing.cost_by_model(records)).usd
}

// The session's earliest readable instant, so the sessions can be ordered oldest-first and the first
// one told from the resumes. A session with no readable timestamp sorts last, which is the honest
// place for one whose order cannot be known.
function started_ms(records: ReadonlyArray<UsageRecord>): number {
	const stamps = records.map((record) => record.at_ms).filter((ms) => ms !== undefined)

	return stamps.length === FIRST ? Infinity : Math.min(...stamps)
}

function mainline_groups(pairs: ReadonlyArray<SessionRecord>): Array<SessionGroup> {
	const groups = new Map<string, SessionGroup>()

	for (const pair of pairs) {
		if (pair.is_delegated) continue

		const group = groups.get(pair.session_id) ?? {
			session_id: pair.session_id,
			records: [],
			baseline: pair.baseline_tokens,
		}

		group.records.push(pair.record)
		groups.set(pair.session_id, group)
	}

	return [...groups.values()].toSorted(
		(left, right) => started_ms(left.records) - started_ms(right.records),
	)
}

function owner_of(session_id: string): string {
	const slash = session_id.indexOf('/')

	return slash === -1 ? session_id : session_id.slice(FIRST, slash)
}

// The dollars each main-line session's delegated units came to, keyed by the owner id. A unit's cost
// is all of its records, not only its launch — this is what the session was responsible for spending.
function delegated_by_owner(pairs: ReadonlyArray<SessionRecord>): Map<string, number> {
	const owned = new Map<string, number>()

	for (const pair of pairs) {
		if (!pair.is_delegated) continue

		const owner = owner_of(pair.session_id)

		owned.set(owner, (owned.get(owner) ?? NO_COST) + cost_of([pair.record]))
	}

	return owned
}

function to_session_cost(
	group: SessionGroup,
	is_resumed: boolean,
	delegated: ReadonlyMap<string, number>,
): SessionCost {
	const models = cost_pricing.cost_by_model(group.records)
	const cost = cost_pricing.total_cost(models).usd

	return {
		session_id: group.session_id,
		is_resumed,
		request_count: group.records.length,
		output_tokens: cost_usage.sum_totals(group.records).output_tokens,
		cost_usd: cost,
		cost_usd_with_delegated: cost + (delegated.get(group.session_id) ?? NO_COST),
		composition: cost_dollar_composition.build(models),
		output_turns: cost_output_turns.build(group.records),
		preamble_tokens: group.baseline,
		metrics: cost_session_metrics.build(group.records),
	}
}

function build(pairs: ReadonlyArray<SessionRecord>): Array<SessionCost> {
	const groups = mainline_groups(pairs)
	const delegated = delegated_by_owner(pairs)

	return groups.map((group, index) => to_session_cost(group, index > FIRST, delegated))
}

const HEADING = 'By main-line session (oldest first):'

function session_line(session: SessionCost): string {
	const spent = `${cost_format.format_usd(session.cost_usd)} (${cost_format.format_usd(session.cost_usd_with_delegated)} with subagents)`
	const counts = `${String(session.request_count)} req · ${cost_format.format_tokens(session.output_tokens)} out`
	const resume = session.is_resumed
		? ` · resume preamble ${cost_format.format_tokens(session.preamble_tokens)}`
		: ''

	return `  ${session.session_id}  ${spent}  ${counts}${resume}`
}

// The session's own line plus the metrics continuation line beneath it (joshuafolkken/kit#1969).
function session_block(session: SessionCost): Array<string> {
	return [session_line(session), cost_session_metrics.format(session.metrics)]
}

// Nothing for a scope with no session axis — a single-session scope carries none — so the session,
// `--all` and empty reports print exactly what they printed before.
function format(by_session: ReadonlyArray<SessionCost>): Array<string> {
	if (by_session.length === 0) return []

	return ['', HEADING, ...by_session.flatMap((one) => session_block(one))]
}

const cost_sessions = { HEADING, build, format }

export type { SessionCost, SessionRecord }
export { cost_sessions }
