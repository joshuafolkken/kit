import { statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { git_gh_issue_read } from '#scripts/git/git-gh-issue-read'
import { NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { issue_state } from '#scripts/issue/issue-state'
import { run_hold } from './run-hold'
import { run_issue_number } from './run-issue-number'

// `josh run:liveness <N>` — whether the delegated unit running child `<N>` is still working, or
// stopped without reporting (joshuafolkken/kit#1485).
//
// joshuafolkken/kit#1212 wrote the detection as a conjunction of four traces an agent read by hand,
// and it could not fire for the stop that actually happened. Its second trace required a **dirty**
// checkout, justified by "a unit that died mid-implementation leaves exactly this" — so a unit that
// died *before* implementing, while it was still reading the skill and the issue, left a clean tree
// and the conjunction stayed false forever. Measured on 2026-09-06: the unit for
// joshuafolkken/kit#1169 stopped seven minutes in, three of the four traces held, and the parent
// went on calling the child in progress for 42 minutes until a person asked.
//
// **Two traces decide it, and neither depends on whether implementation started**: the unit's output
// has stopped growing, and no process of the child's is alive in that checkout. The dirty tree is
// demoted from the test to an input of the recovery — it says whether there is anything to stash,
// which is a different question from whether the unit is alive. "Nothing was ever opened for the
// child" is dropped outright: it is also the normal state of a unit that has not reached its commit
// yet, and the branch-and-pull-request question already has an owner in `josh run:preflight`.
//
// **The binding constraint is the direction of the error.** A live unit booked as stopped has its
// working work killed; a stopped unit booked as alive costs waiting. So the ladder reads the one
// unambiguous sign of life first — output that moved — then settles, then refuses to answer at all
// where a trace could not be read, and only decides between a long check and a stop once every trace
// has answered.
//
// **The output read follows the link.** The path a unit writes its transcript to is a symbolic link, and
// the link's own modification time never changes after it is created — read with the shell's `stat`,
// which does not follow by default on macOS, the file looks frozen whether the unit is alive or
// dead. That is the second half of joshuafolkken/kit#1485: the same parent reported a dead unit as
// alive twice on such a read. `statSync` follows the link, and the size is compared as well as the
// modification time, because it is the two-sample size comparison that actually proved liveness.

const ALIVE_VERDICT = 'alive'
const SETTLED_VERDICT = 'settled'
const STOPPED_VERDICT = 'stopped'
const UNDETERMINED_VERDICT = 'undetermined'

type LivenessVerdict =
	| typeof ALIVE_VERDICT
	| typeof SETTLED_VERDICT
	| typeof STOPPED_VERDICT
	| typeof UNDETERMINED_VERDICT

// The one trace this command cannot read for itself. A process scan that matched too little would
// book a live unit as stopped, and one that matched too much would never detect anything — so the
// caller runs the `pgrep` the skill specifies against the checkout it handed the unit, and passes
// what it saw. `unknown` is the default, and a trace nobody gave is an unasked question rather than
// an answer of "no process".
const PROCESS_ALIVE = 'alive'
const PROCESS_NONE = 'none'
const PROCESS_UNKNOWN = 'unknown'

type ProcessTrace = typeof PROCESS_ALIVE | typeof PROCESS_NONE | typeof PROCESS_UNKNOWN

const DEFAULT_SILENT_MINUTES = 30
// Two samples, a few seconds apart. The gap is what turns "this file has an old timestamp" into
// "this file is not being written", and five seconds is long enough for a unit mid-turn to append.
const DEFAULT_GAP_SECONDS = 5
const MS_PER_MINUTE = 60_000
const MS_PER_SECOND = 1000
const OPEN_STATE = 'OPEN'
const STATE_FIELDS = 'state,labels'

interface OutputSample {
	mtime_ms: number
	size: number
}

interface Traces {
	is_child_settled: boolean | undefined
	is_output_frozen: boolean | undefined
	is_tree_dirty: boolean
	process_trace: ProcessTrace
}

interface LivenessDecision {
	advice: string
	has_work_to_stash: boolean
	reason: string
	verdict: LivenessVerdict
}

interface LivenessRequest {
	gap_ms?: number
	issue: string
	output_path: string
	process_trace: ProcessTrace
	repo?: string
	silent_window_ms?: number
}

const REASONS: Record<LivenessVerdict, string> = {
	[ALIVE_VERDICT]:
		'The unit is still working: its output moved, or a process of the child is alive.',
	[SETTLED_VERDICT]:
		'The child is closed, or parked with `needs-decision`, so there is nothing here to recover.',
	[STOPPED_VERDICT]:
		'The output has been frozen past the silent window and no process of the child is alive in that checkout.',
	[UNDETERMINED_VERDICT]:
		'A trace could not be read, so this says nothing about the unit. A trace that could not be read answers `undetermined`, never `stopped`.',
}

const ALIVE_ADVICE = 'Keep polling; do not touch the child.'
const SETTLED_ADVICE =
	'Read the child with `pnpm josh issue:state <N>` and take the branch its state says.'
const STOPPED_CLEAN_ADVICE =
	'Book the child as a failed one: remove `in-progress`, park it with `needs-decision` naming what was observed, count it against the consecutive-failure guard, and go back to step 1. The checkout is clean, so there is nothing to stash.'
const STOPPED_DIRTY_ADVICE =
	'Stash the half-finished work with `git stash push -u -m "epicrun: stopped unit for #<N>"` and record it on the Issue, then remove `in-progress`, park the child with `needs-decision`, count it against the consecutive-failure guard, and go back to step 1.'
const UNDETERMINED_ADVICE =
	'Read the trace that failed and ask again. Where the process trace was never given, run the `pgrep` against the checkout the unit was given and pass `--process alive` or `--process none`. Two of these in a row is a fault in the check itself rather than a slow unit: stop polling and report it.'

// Output that moved is a unit that is writing, and it is asked before anything else — it is the one
// reading that needs no other trace to mean what it says.
function is_output_moving(traces: Traces): boolean {
	return traces.is_output_frozen === false
}

// A live process is a unit inside a long check — a `pnpm josh followup --merge` waiting on CI writes
// nothing for up to 32 minutes, which is longer than the silent window and is exactly the false
// positive this trace exists to stop. **It is asked after the unreadable check rather than before it**
// (joshuafolkken/kit#1485, review round 2): a `pgrep` scoped a shade too wide answers `alive` on a
// machine running several kit projects at once, and read ahead of an output path that resolves to
// nothing it would answer `alive` on every poll forever — the unbounded stall this command exists to
// remove, reappearing where nothing would ever count it.
function is_check_running(traces: Traces): boolean {
	return traces.process_trace === PROCESS_ALIVE
}

// A trace that answered nothing makes the verdict `undetermined` rather than pushing it either way —
// the same fail-closed reading `run:hold` gives an unreadable record.
function has_unreadable_trace(traces: Traces): boolean {
	return (
		traces.is_child_settled === undefined ||
		traces.is_output_frozen === undefined ||
		traces.process_trace === PROCESS_UNKNOWN
	)
}

function to_verdict(traces: Traces): LivenessVerdict {
	if (is_output_moving(traces)) return ALIVE_VERDICT
	if (traces.is_child_settled === true) return SETTLED_VERDICT
	if (has_unreadable_trace(traces)) return UNDETERMINED_VERDICT

	return is_check_running(traces) ? ALIVE_VERDICT : STOPPED_VERDICT
}

function to_advice(verdict: LivenessVerdict, has_work_to_stash: boolean): string {
	if (verdict === ALIVE_VERDICT) return ALIVE_ADVICE
	if (verdict === SETTLED_VERDICT) return SETTLED_ADVICE
	if (verdict === UNDETERMINED_VERDICT) return UNDETERMINED_ADVICE

	return has_work_to_stash ? STOPPED_DIRTY_ADVICE : STOPPED_CLEAN_ADVICE
}

function decide(traces: Traces): LivenessDecision {
	const verdict = to_verdict(traces)
	const has_work_to_stash = verdict === STOPPED_VERDICT && traces.is_tree_dirty

	return {
		advice: to_advice(verdict, has_work_to_stash),
		has_work_to_stash,
		reason: REASONS[verdict],
		verdict,
	}
}

// The two roots a unit's output can legitimately be under: the agent harness writes a transcript into
// the user's own data directory, and a test writes one into the OS temp directory. The path is
// validated against them rather than merely normalized, because the argument is composed by an agent
// rather than typed by a person, and a `stat` that can be pointed anywhere is an existence oracle for
// the whole file system.
const ALLOWED_ROOTS: ReadonlyArray<string> = [homedir(), tmpdir()]

function is_within(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate)

	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

// Absolute is required before the root test, and it is a correctness rule before it is a safety one:
// this command is routinely asked about a *different* checkout, and a relative path would resolve
// against whatever directory the caller happened to run from, which is rarely the one meant.
// Normalizing first is what makes both tests worth anything, since it is what collapses whatever `..`
// the caller wrote.
function to_safe_path(output_path: string): string | undefined {
	const normalized = path.normalize(output_path)

	if (!path.isAbsolute(normalized)) return undefined

	return ALLOWED_ROOTS.some((root) => is_within(normalized, root)) ? normalized : undefined
}

// `statSync` follows a symbolic link; `lstatSync` and the shell's bare `stat` do not. That difference is
// the whole of joshuafolkken/kit#1485's second symptom, so it is stated here rather than left to a
// reader to know. A path that resolves to nothing, or to something that is not a regular file, is
// unreadable rather than frozen.
function sample_output(output_path: string): OutputSample | undefined {
	const safe_path = to_safe_path(output_path)

	if (safe_path === undefined) return undefined

	const stats = statSync(safe_path, { throwIfNoEntry: false })

	if (!stats?.isFile()) return undefined

	return { mtime_ms: stats.mtimeMs, size: stats.size }
}

interface FreshnessRequest {
	gap_ms: number
	now_ms: number
	output_path: string
	silent_window_ms: number
}

// Frozen means both: nothing was written inside the silent window, and nothing was written between
// two samples taken a few seconds apart. The window alone would call a unit stopped the moment its
// clock crossed 30 minutes, and the two samples alone would call a slow turn a stop.
async function read_output_frozen(request: FreshnessRequest): Promise<boolean | undefined> {
	const first = sample_output(request.output_path)

	if (first === undefined) return undefined
	if (request.now_ms - first.mtime_ms < request.silent_window_ms) return false

	await sleep(request.gap_ms)

	const second = sample_output(request.output_path)

	if (second === undefined) return undefined

	return second.mtime_ms === first.mtime_ms && second.size === first.size
}

function carries_label(labels: ReadonlyArray<string>, wanted: string): boolean {
	return labels.some((label) => label.toLowerCase() === wanted)
}

// Settled needs positive evidence that the child is done with: it closed, or the unit parked it and
// then stopped, which the loop's park branch already owns. **An open child that is not parked is not settled
// even without `in-progress`** — that label is applied by the unit itself, after it reads the issue,
// so a unit that died before applying it would otherwise be reported as a child needing nothing
// (joshuafolkken/kit#1485, review round 1). Read that way, the stop this command exists for goes
// undetected.
async function read_child_settled(issue: string, repo?: string): Promise<boolean | undefined> {
	const json = await git_gh_issue_read.issue_view_json(issue, STATE_FIELDS, repo)

	if (json === undefined) return undefined

	const state = issue_state.parse_issue_state(json)

	if (state === undefined) return undefined

	return state.state !== OPEN_STATE || carries_label(state.labels, NEEDS_DECISION_LABEL)
}

// The dirty tree is deliberately not one of the traces, so it is the one input that does not answer
// `undetermined`. `run_hold.is_tree_dirty` reports an unreadable checkout as dirty, which here means
// the advice offers a stash that may find nothing — the safe direction for the only question this
// input decides, and one that cannot move the verdict.
async function read_traces(request: LivenessRequest): Promise<Traces> {
	const [is_child_settled, is_output_frozen, is_tree_dirty] = await Promise.all([
		read_child_settled(request.issue, request.repo),
		read_output_frozen({
			gap_ms: request.gap_ms ?? DEFAULT_GAP_SECONDS * MS_PER_SECOND,
			now_ms: Date.now(),
			output_path: request.output_path,
			silent_window_ms: request.silent_window_ms ?? DEFAULT_SILENT_MINUTES * MS_PER_MINUTE,
		}),
		run_hold.is_tree_dirty(),
	])

	return { is_child_settled, is_output_frozen, is_tree_dirty, process_trace: request.process_trace }
}

async function check(request: LivenessRequest): Promise<LivenessDecision> {
	run_issue_number.require_issue_number(request.issue)

	return decide(await read_traces(request))
}

// The constants are exported by name rather than through the namespace: read back off a namespace
// object their literal types widen to `string`, and `ProcessTrace` would then admit anything.
const run_liveness = { check, decide, read_child_settled, read_output_frozen, sample_output }

export type {
	LivenessDecision,
	LivenessRequest,
	LivenessVerdict,
	OutputSample,
	ProcessTrace,
	Traces,
}
export {
	ALIVE_VERDICT,
	DEFAULT_GAP_SECONDS,
	DEFAULT_SILENT_MINUTES,
	MS_PER_MINUTE,
	MS_PER_SECOND,
	PROCESS_ALIVE,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	run_liveness,
	SETTLED_VERDICT,
	STOPPED_VERDICT,
	UNDETERMINED_VERDICT,
}
