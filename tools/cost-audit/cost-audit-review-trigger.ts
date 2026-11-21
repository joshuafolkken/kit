import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { lane_session_action } from '#scripts/lane/lane-session-action'
import { lane_transcript_calls } from '#scripts/lane/lane-transcript-calls'
import { review_prompt_level, type ReviewTrigger } from '#scripts/review/review-prompt-level'
import type { AuditSession } from './cost-audit-read'
import type { TriggerRow, TriggerTotal } from './cost-audit-resume'

// Why a reviewer was started, for `josh cost:audit`'s reviewer table (joshuafolkken/kit#8361).
//
// **A prompt's own `trigger: <word>` wins** — `review-prompt-level.ts` is the single source of the
// words. A run from before that line existed is placed by its prompt: the round-2 lead, the interaction
// brief's path or the paired review's wording names its pass, a round-2 agent its round, else the
// first round. A `josh ship` reviewer is a top-level session, counted by its prompt alone. A second
// run of the same pass in the same Issue is a retry whose cause the prompt does not say. A run outside
// a lane keeps a written trigger and is otherwise `unknown`, having no Issue to order it by; every run
// of an Issue the lane ledger never merged is `unmerged` whatever its trigger. Both are still counted.

const ROUND_TWO_AGENT = 'reviewer-verification'
const REVIEWER_AGENTS: ReadonlySet<string> = new Set(['reviewer', ROUND_TWO_AGENT])
const ROUND_TWO: ReviewTrigger = 'round-2'
// The round-2 prompt's lead, the interaction brief's path or block and the paired review's wording,
// as past prompts carry them (`scripts/review/review-pair.ts`), each with the pass it names. Round 2
// is read first: an interaction round 2 also names the interaction brief.
const PROMPT_PASSES: ReadonlyArray<readonly [ReadonlyArray<string>, ReviewTrigger]> = [
	[lane_transcript_calls.ROUND_TWO_MARKERS, ROUND_TWO],
	[lane_transcript_calls.INTERACTION_MARKERS, 'interaction'],
	[['paired /code-review, recorded only'], 'paired'],
]
const INITIAL: ReviewTrigger = 'initial'
const RETRY = 'retry (unknown cause)'
const UNKNOWN = 'unknown'
const UNMERGED = 'unmerged'
const KEYS: ReadonlyArray<string> = [...review_prompt_level.TRIGGERS, RETRY, UNKNOWN, UNMERGED]
const TITLE =
	'Reviewer runs by trigger (cost · runs · cost per merge, each beside the period before)'
const NO_LEDGER =
	'  (the lane ledger could not be read, so runs of unmerged Issues are not split out)'

type IsCounted = (at_ms: number | undefined) => boolean

interface Periods {
	current: IsCounted
	previous: IsCounted
}

interface ReviewTriggers {
	rows: ReadonlyArray<TriggerRow>
	// Whether the lane ledger was read, so the `unmerged` row is split out.
	is_merge_known: boolean
}

interface Placed {
	session: AuditSession
	trigger: string
}

interface PlaceContext {
	merged_issues: ReadonlySet<number> | undefined
	// Each Issue's passes already run, keyed `<issue> <pass>`.
	seen: Set<string>
}

// The agent type with a consumer's `kit:` prefix dropped.
function agent_of(session: AuditSession): string {
	return session.agent_type?.split(':').at(-1) ?? ''
}

function written_of(session: AuditSession): ReviewTrigger | undefined {
	return review_prompt_level.trigger_of(session.prompt ?? '')
}

function prompt_pass(prompt: string): ReviewTrigger | undefined {
	return PROMPT_PASSES.find(([markers]) => markers.some((marker) => prompt.includes(marker)))?.[1]
}

// A `josh ship` reviewer is a top-level session, not a delegated unit, so it has no agent type: its
// prompt's `trigger:` line or the ship brief's path marks it.
function is_ship_reviewer(session: AuditSession): boolean {
	const prompt = session.prompt ?? ''

	return written_of(session) !== undefined || prompt.includes(lane_session_action.BRIEF_PREFIX)
}

function is_reviewer(session: AuditSession): boolean {
	if (session.agent_type === undefined) return is_ship_reviewer(session)

	return REVIEWER_AGENTS.has(agent_of(session))
}

// The trigger a run without a `trigger:` line is placed under on its first run in its Issue.
function inferred(session: AuditSession): ReviewTrigger {
	const round = agent_of(session) === ROUND_TWO_AGENT ? ROUND_TWO : INITIAL

	return prompt_pass(session.prompt ?? '') ?? round
}

function is_unmerged(issue: number, merged_issues: ReadonlySet<number> | undefined): boolean {
	return merged_issues !== undefined && !merged_issues.has(issue)
}

// A lane run's trigger; a second run of one pass in one Issue with no `trigger:` line is a retry.
function lane_trigger(session: AuditSession, issue: number, context: PlaceContext): string {
	if (is_unmerged(issue, context.merged_issues)) return UNMERGED

	const written = written_of(session)
	const pass = written ?? inferred(session)
	const key = `${String(issue)} ${pass}`
	const is_retry = written === undefined && context.seen.has(key)

	context.seen.add(key)

	return is_retry ? RETRY : pass
}

function place(session: AuditSession, context: PlaceContext): string {
	if (session.issue === undefined) return written_of(session) ?? UNKNOWN

	return lane_trigger(session, session.issue, context)
}

// The reviewer runs, oldest first, each placed under its trigger.
function placed_of(
	sessions: ReadonlyArray<AuditSession>,
	merged_issues: ReadonlySet<number> | undefined,
): Array<Placed> {
	const context: PlaceContext = { merged_issues, seen: new Set() }

	return sessions
		.filter((session) => is_reviewer(session))
		.map((session) => ({ session, trigger: place(session, context) }))
}

function add_run(totals: Map<string, TriggerTotal>, run: Placed, is_counted: IsCounted): void {
	const records = run.session.records.filter((record) => is_counted(record.at_ms))

	if (records.length === 0) return

	const earlier = totals.get(run.trigger) ?? { sessions: 0, usd: 0 }

	totals.set(run.trigger, {
		sessions: earlier.sessions + 1,
		usd: earlier.usd + cost_pricing.cost_of(records),
	})
}

function totals_of(runs: ReadonlyArray<Placed>, is_counted: IsCounted): Map<string, TriggerTotal> {
	const totals = new Map<string, TriggerTotal>()

	for (const run of runs) add_run(totals, run, is_counted)

	return totals
}

// Every trigger in a fixed order, both periods, so a zero row still shows; `unmerged` only when the
// lane ledger was read.
function breakdown_of(
	sessions: ReadonlyArray<AuditSession>,
	merged_issues: ReadonlySet<number> | undefined,
	periods: Periods,
): ReviewTriggers {
	const runs = placed_of(sessions, merged_issues)
	const now = totals_of(runs, periods.current)
	const before = totals_of(runs, periods.previous)
	const zero: TriggerTotal = { sessions: 0, usd: 0 }
	const is_merge_known = merged_issues !== undefined
	const keys = KEYS.filter((key) => is_merge_known || key !== UNMERGED)
	const rows = keys.map((key) => ({
		key,
		current: now.get(key) ?? zero,
		previous: before.get(key) ?? zero,
	}))

	return { rows, is_merge_known }
}

// The table's lines, each row formatted by `line_of` — the resume table's own row format.
function section_lines(
	triggers: ReviewTriggers,
	line_of: (row: TriggerRow) => string,
): Array<string> {
	const note = triggers.is_merge_known ? [] : [NO_LEDGER]

	return ['', TITLE, ...triggers.rows.map((row) => line_of(row)), ...note]
}

const cost_audit_review_trigger = {
	NO_LEDGER,
	RETRY,
	TITLE,
	UNKNOWN,
	UNMERGED,
	breakdown_of,
	section_lines,
}

export type { ReviewTriggers }
export { cost_audit_review_trigger }
