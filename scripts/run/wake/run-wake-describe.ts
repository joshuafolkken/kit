import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { issue_citation } from '#scripts/rules/issue-citation'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_liveness } from '#scripts/run/run-liveness'
import { run_wake, type RunWake, type WakeDecision, type WakeDecisionInput } from './run-wake'

// The `--list` presentation of a wake record. What the command *does* stays in `run-wake-cli.ts`; how
// a supervisor's record reads back to a person lives here, one cohesive block.

const UNKNOWN_CUTS = 'an unreadable number of'
const REPO_LOOKUP_TIMEOUT_MS = 10_000
const STOP_COMMAND = 'pnpm josh run:wake --stop'
const UNREADABLE_TIME = 'an unreadable time'

// The three paths every verb needs: the carry record it reads, its own record, and the work tree a
// woken session runs in. The work tree is the common git directory's parent, which is the *primary*
// checkout — a lane must never be where the next session resumes, because a lane belongs to one child.
interface WakeContext {
	carry_target: string
	wake_target: string
	// Where everything this supervisor starts writes its output. It is named
	// in `--list` and in every warning, because a path nobody is told is a file nobody reads.
	log_target: string
	// The run's event stream, keyed on the primary checkout's git directory — the one the resumed
	// `backlogrun` parent runs in, so its own git directory is this common one, exactly the key the emit
	// side uses. `--list` relays the newest event from here: the report surface belongs to the run, and
	// `--list` is the degenerate last-event read of the same stream the attached session follows.
	event_target: string
	worktree: string
}

function carry_cuts(read: CarryRead): string {
	if (read.kind === 'carried' || read.kind === 'expired') return String(read.carry.cuts)

	return UNKNOWN_CUTS
}

// **A wake that has gone out and has not been answered is said out loud.** Read from `woke` and `cuts`
// alone, the forty minutes a supervisor spends retrying one lost cut look exactly like the second
// before its first launch. `attempts` is present only while a cut is unserved, which is why its
// absence is what prints nothing.
function outstanding_line(wake: RunWake): string | undefined {
	if (wake.attempts === undefined) return undefined

	return `${String(wake.attempts)} launch(es) outstanding for the current cut, none claimed yet`
}

// **Why the supervisor is not launching, and until when.** A supervisor that waits writes nothing to
// its log, so without this `--list` would show a stalled run and a waiting one alike. The state is
// `run_wake.decide`'s own answer rather than a second reading of the record: an `idle_since` mark is
// the last pass having found no work, so it is fed back in as `has_work: false`.
function wait_input(wake: RunWake, read: CarryRead, now: Date): WakeDecisionInput {
	return {
		read,
		woke_at: wake.woke_at,
		attempts: wake.attempts ?? 0,
		is_owner_live: read.kind === 'carried' && run_carry.is_owner_live(read.carry, now),
		has_work: wake.idle_since === undefined ? undefined : false,
		idle_since: wake.idle_since,
		now,
	}
}

function deadline(marked_at: string | undefined, limit_ms: number): string {
	const marked = Date.parse(marked_at ?? '')

	return Number.isNaN(marked) ? UNREADABLE_TIME : new Date(marked + limit_ms).toISOString()
}

// A live owner that is this supervisor is its own driver at work; any other is a session spending the
// budget, which has no deadline of its own short of the carry record's whole-run expiry.
function owner_wait(wake: RunWake, carry: RunCarry): string {
	if (carry.owner_pid === wake.pid) {
		return 'waiting: the driver holds the carry record and is running'
	}

	const expiry = deadline(carry.started_at, run_carry.CARRY_MAX_AGE_MS)

	return `waiting: process ${String(carry.owner_pid)} holds the carry record; the driver starts at its next cut or once it exits, and the record expires at ${expiry}`
}

const WAIT_LINES: Partial<Record<WakeDecision['kind'], (wake: RunWake) => string>> = {
	pending: (wake) =>
		`waiting: the woken session has until ${deadline(wake.woke_at, run_wake.WAKE_GRACE_MS)} to claim the carry record`,
	idle: (wake) =>
		`waiting: no runnable work; the driver starts anyway at ${deadline(wake.idle_since, run_wake.IDLE_CEILING_MS)}`,
}

function wait_line(wake: RunWake, read: CarryRead, now: Date): string | undefined {
	const { kind } = run_wake.decide(wait_input(wake, read, now))

	if (kind === 'wait' && read.kind === 'carried') return owner_wait(wake, read.carry)

	return WAIT_LINES[kind]?.(wake)
}

// The run's stream, read here because a headless parent's progress reaches its own transcript alone —
// after a cut, `--list` is the person's one window onto it. Two lines: the newest event (the
// degenerate last-event read of the stream the board pane draws, so `--list` and the pane read one
// stream rather than two paths), and how to watch on from here in a pane of its own — `run:board`, the
// same surface before and after the cut, with `tail -F` on the raw stream named as a recovery path
// rather than the ambient one. The event line is omitted before the first event, the way
// `outstanding_line` omits a count of zero; the watch line is always shown.
function stream_lines(context: WakeContext): Array<string> {
	const event = run_event_stream.read_last(context.event_target)
	const progress = event === undefined ? [] : [`progress: ${run_event_stream.format_event(event)}`]
	const follow = `watch: \`pnpm josh run:board\` in a pane of its own (recover with \`tail -F ${context.event_target}\`)`

	return [...progress, follow]
}

// The wake count is printed beside the carry record's `cuts` rather than alone, because their relation
// is the property worth being able to check — one wake per cut, plus one per crashed session the
// supervisor recovered, so `woke >= cuts` and the gap is the recoveries. `woke < cuts` is the
// shortfall that says a cut went unserved; `woke` counts records actually claimed rather than sessions
// started.
// **The outstanding line beside it is what makes a shortfall readable**: the count is observed at a
// poll, so it lags a claim by up to one interval, and launches still outstanding are what say whether
// a missing wake is one not yet seen or one that never arrived.
function describe_wake(wake: RunWake, context: WakeContext, now: Date = new Date()): string {
	const live = run_wake.is_supervisor_live(wake) ? 'running' : 'not running'
	const read = run_carry.read_carry(context.carry_target)

	return [
		`invocation: ${wake.invocation}`,
		`profile: ${wake.profile === undefined ? 'unrecorded' : agent_role_profile.describe(wake.profile)}`,
		`supervisor: process ${String(wake.pid)} (${live}), watching since ${wake.started_at}`,
		`woke ${String(wake.woke)} session(s) across ${carry_cuts(read)} cut(s)`,
		outstanding_line(wake),
		wait_line(wake, read, now),
		run_liveness.describe_agent_state(context.log_target),
		`output: ${context.log_target}`,
		// How progress is seen without asking after the cut: the run's stream, followed from here.
		// `--list` is that reader's one-shot last-event form.
		...stream_lines(context),
		`stop it with \`${STOP_COMMAND}\``,
	]
		.filter((line) => line !== undefined)
		.join('\n')
}

// The description as a person reads it, every issue on it a number-link. The
// invocation and the newest event both name issues (`backlogrun #1 #2`, `#1904 merged`), and a report
// that copies them bare is what the Stop guard sends back. The repository is asked here, bounded, rather
// than in the context every verb resolves: only the two describing verbs print it, and a lookup that
// does not answer leaves the description as it was rather than withholding it.
function cite_description(description: string, repo: string | undefined): string {
	return repo === undefined ? description : issue_citation.linkify(description, repo)
}

function describe_wake_cited(wake: RunWake, context: WakeContext): string {
	const repo = gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS)

	return cite_description(describe_wake(wake, context), repo)
}

const run_wake_describe = { STOP_COMMAND, cite_description, describe_wake, describe_wake_cited }

export type { WakeContext }
export { run_wake_describe }
