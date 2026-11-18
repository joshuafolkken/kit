import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_breakdown_calls } from './lane-breakdown-calls'
import { lane_ledger, type LedgerEntry, type TestRelatedEntry } from './lane-ledger'
import type { ToolCall } from './lane-transcript-calls'

// The timed steps inside `josh lane:breakdown <issue> --timeline`'s stages (joshuafolkken/kit#7737):
// from the ledger, each ship stage's laps, each `run:chain`, `test:related` and `test:pinned`, the
// followup's CI and CodeRabbit waits and each review round's verdict; from the transcripts, what the
// ledger does not time — each `lint:related` and each review pass. The ship stages are numbered by
// attempt: a ship preflight or the pre-detach checks open one, unless one of the two ran just before.

const { KIND } = lane_ledger
const OPENING_STAGES: ReadonlySet<string> = new Set([
	run_ship_stage.STAGE.PREFLIGHT,
	lane_ledger.PRE_DETACH_STAGE,
])

const SHIP_LEAD = 'ship '
const LAP_SEPARATOR = ' › '
const MERGE_STEP = 'merge'
const NO_SCOPE = 'none'
const TREE_KEY_LENGTH = 8
const DETAIL_SEPARATOR = '; '
const EVENT_LEAD_MS = 1000
const LINT_RELATED = 'lint:related'
const REVIEW_PASSES = ['round ', 'interaction']
const WAIT_STAGES: ReadonlySet<string> = new Set([
	lane_ledger.CI_WAIT_STAGE,
	lane_ledger.CODERABBIT_WAIT_STAGE,
	lane_ledger.CODERABBIT_RATE_LIMIT_STAGE,
])

// One step: timed from its start, or a point without `ms`.
interface Step {
	at_ms: number
	ms?: number
	name: string
}

function timed(entry: { at: string; elapsed_ms: number }, name: string): Step {
	return { at_ms: Date.parse(entry.at) - entry.elapsed_ms, ms: entry.elapsed_ms, name }
}

// A ship stage's own lap, not a nested one (`josh git › push`) or the main merge-in the timeline
// prints apart.
function is_own_lap(step: string): boolean {
	return step !== MERGE_STEP && !step.includes(LAP_SEPARATOR)
}

function lap_step(entry: LedgerEntry): Array<Step> {
	if (entry.kind !== KIND.SHIP_LAP || !is_own_lap(entry.step)) return []

	return [timed(entry, `${SHIP_LEAD}${entry.stage}${LAP_SEPARATOR}${entry.step}`)]
}

function chain_step(entry: LedgerEntry): Array<Step> {
	if (entry.kind !== KIND.CHAIN) return []

	const join = entry.join ? ' --join' : ''
	const stage = entry.stage === undefined ? '' : ` (${entry.stage})`

	return [timed(entry, `run:chain${join}${stage}`)]
}

function labelled(label: string, value: string | undefined): Array<string> {
	return value === undefined ? [] : [`${label} ${value}`]
}

// The run's scope, then what a row written since joshuafolkken/kit#7965 adds: how it ended, who
// started it, the head of its tree key and the files it failed on.
function related_details(entry: TestRelatedEntry): string {
	const exit = entry.exit_code === undefined ? undefined : String(entry.exit_code)

	return [
		entry.scope,
		...labelled('exit', exit),
		...labelled('caller', entry.caller),
		...labelled('tree', entry.tree?.slice(0, TREE_KEY_LENGTH)),
		...labelled('failed', entry.failed?.join(', ')),
	].join(DETAIL_SEPARATOR)
}

function check_step(entry: LedgerEntry): Array<Step> {
	if (entry.kind === KIND.TEST_PINNED) return [timed(entry, 'test:pinned')]
	if (entry.kind !== KIND.TEST_RELATED || entry.scope === NO_SCOPE) return []

	return [timed(entry, `test:related (${related_details(entry)})`)]
}

function wait_step(entry: LedgerEntry): Array<Step> {
	return entry.kind === KIND.STAGE && WAIT_STAGES.has(entry.stage)
		? [timed(entry, entry.stage)]
		: []
}

function round_step(entry: LedgerEntry): Array<Step> {
	if (entry.kind === KIND.ROUND_ONE) {
		return [{ at_ms: Date.parse(entry.at), name: `review round 1 (${entry.verdict})` }]
	}

	return entry.kind === KIND.ROUND_TWO
		? [{ at_ms: Date.parse(entry.at), name: `review round 2 (${entry.verdict})` }]
		: []
}

function is_issue(entry: LedgerEntry, issue: number): boolean {
	return 'issue' in entry && entry.issue === issue
}

function ledger_steps(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<Step> {
	const readers = [lap_step, chain_step, check_step, wait_step, round_step]

	return entries
		.filter((entry) => is_issue(entry, issue))
		.flatMap((entry) => readers.flatMap((read) => read(entry)))
}

function is_wanted(label: string): boolean {
	return label === LINT_RELATED || REVIEW_PASSES.some((pass) => label.startsWith(pass))
}

// The `lint:related` calls and review passes, whose time only the transcripts hold.
function call_step(call: ToolCall): Array<Step> {
	const name = lane_breakdown_calls.label_of(call)

	if (call.duration_ms === undefined || !is_wanted(name)) return []

	return [{ at_ms: call.started_ms, ms: call.duration_ms, name }]
}

function call_steps(calls: ReadonlyArray<ToolCall>): Array<Step> {
	return calls.flatMap((call) => call_step(call))
}

function of(
	entries: ReadonlyArray<LedgerEntry>,
	calls: ReadonlyArray<ToolCall>,
	issue: number,
): Array<Step> {
	return [...ledger_steps(entries, issue), ...call_steps(calls)]
}

// A ship stage from its start, or a ship stop at its point.
function ship_mark(entry: LedgerEntry): Array<Step> {
	if (entry.kind === KIND.STAGE) return [timed(entry, entry.stage)]

	return entry.kind === KIND.STOP ? [{ at_ms: Date.parse(entry.at), name: KIND.STOP }] : []
}

// Whether `name` opens an attempt after `previous`: a preflight or the pre-detach checks, unless one
// of the two ran just before. A `--review` re-ship on an unmoved base passes over the foreground
// preflight (`run-ship-reship.ts`), the detached half's preflight follows the pre-detach checks, and an
// infrastructure retry runs the preflight again in place (`run-ship-infra-retry.ts`).
function opens_attempt(name: string, previous: string | undefined): boolean {
	return OPENING_STAGES.has(name) && (previous === undefined || !OPENING_STAGES.has(previous))
}

// When each ship attempt started, read off the ledger's stage and stop lines, which outlive the event
// stream: a stop between the pre-detach checks and the next preflight ends the attempt.
function attempt_starts(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<number> {
	const stages = entries
		.filter((entry) => is_issue(entry, issue))
		.flatMap((entry) => ship_mark(entry))
		.toSorted((left, right) => left.at_ms - right.at_ms)

	return stages
		.filter((stage, index) => opens_attempt(stage.name, stages[index - 1]?.name))
		.map((stage) => stage.at_ms)
}

// `name` with its ship attempt's number — `ship #2 sync` — or as it is outside a ship stage or
// before the first attempt. A stage's event line falls a moment before the ledger's start it opens.
function numbered(name: string, at_ms: number, starts: ReadonlyArray<number>): string {
	const until_ms = at_ms + EVENT_LEAD_MS
	const attempt = starts.filter((start) => start <= until_ms).length

	if (attempt === 0 || !name.startsWith(SHIP_LEAD)) return name

	return `${SHIP_LEAD}#${String(attempt)} ${name.slice(SHIP_LEAD.length)}`
}

const lane_timeline_steps = { attempt_starts, numbered, of }

export { lane_timeline_steps }
export type { Step }
