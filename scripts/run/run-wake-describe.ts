import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { run_carry, type CarryRead } from './run-carry'
import { run_event_stream } from './run-event-stream'
import { run_liveness } from './run-liveness'
import { run_wake, type RunWake } from './run-wake'

// The `--list` presentation of a wake record (joshuafolkken/kit#2407 split it out of `run-wake-cli.ts`,
// which had reached its line limit). What the command *does* stays in the CLI; how a supervisor's
// record reads back to a person lives here, one cohesive block.

const UNKNOWN_CUTS = 'an unreadable number of'
const STOP_COMMAND = 'pnpm josh run:wake --stop'

// The three paths every verb needs: the carry record it reads, its own record, and the work tree a
// woken session runs in. The work tree is the common git directory's parent, which is the *primary*
// checkout — a lane must never be where the next session resumes, because a lane belongs to one child.
interface WakeContext {
	carry_target: string
	wake_target: string
	// Where everything this supervisor starts writes its output (joshuafolkken/kit#1746). It is named
	// in `--list` and in every warning, because a path nobody is told is a file nobody reads.
	log_target: string
	// The run's event stream, keyed on the primary checkout's git directory — the one the resumed
	// `backlogrun` parent runs in, so its own git directory is this common one, exactly the key the emit
	// side uses. `--list` relays the newest event from here: the report surface belongs to the run, and
	// `--list` is the degenerate last-event read of the same stream the attached session follows
	// (joshuafolkken/kit#2207).
	event_target: string
	worktree: string
}

function carry_cuts(read: CarryRead): string {
	if (read.kind === 'carried' || read.kind === 'expired') return String(read.carry.cuts)

	return UNKNOWN_CUTS
}

// **A wake that has gone out and has not been answered is said out loud** (joshuafolkken/kit#1746).
// Read from `woke` and `cuts` alone, the forty minutes a supervisor spends retrying one lost cut look
// exactly like the second before its first launch — so a person checking on a stalled backlog was
// shown nothing to check. `attempts` is present only while a cut is unserved, which is why its
// absence is what prints nothing.
function outstanding_line(wake: RunWake): string | undefined {
	if (wake.attempts === undefined) return undefined

	return `${String(wake.attempts)} launch(es) outstanding for the current cut, none claimed yet`
}

// The run's stream, read here because a headless parent's progress reaches its own transcript alone —
// after a cut, `--list` is the person's one window onto it (joshuafolkken/kit#1910). Two lines: the
// newest event (the degenerate last-event read of the stream the watch pane follows, so `--list` and
// the pane read one stream rather than two paths), and how to watch on from here in a pane of its own —
// the same surface before and after the cut, with `tail -F` on the raw stream named as a recovery path
// rather than the ambient one (joshuafolkken/kit#2207, joshuafolkken/kit#2492). The event line is
// omitted before the first event, the way `outstanding_line` omits a count of zero; the watch line is
// always shown.
function stream_lines(context: WakeContext): Array<string> {
	const event = run_event_stream.read_last(context.event_target)
	const progress = event === undefined ? [] : [`progress: ${run_event_stream.format_event(event)}`]
	const follow = `watch: \`pnpm josh run:event --watch ${String(event?.pos ?? 0)}\` in a pane of its own (recover with \`tail -F ${context.event_target}\`)`

	return [...progress, follow]
}

// The wake count is printed beside the carry record's `cuts` rather than alone, because their relation
// is the property worth being able to check — one wake per cut, plus one per crashed session the
// supervisor recovered (joshuafolkken/kit#2336), so `woke >= cuts` and the gap is the recoveries.
// `woke < cuts` is the shortfall that says a cut went unserved, and since joshuafolkken/kit#1746 `woke`
// counts records actually claimed rather than sessions started.
// **The outstanding line beside it is what makes a shortfall readable**: the count is observed at a
// poll, so it lags a claim by up to one interval, and launches still outstanding are what say whether
// a missing wake is one not yet seen or one that never arrived.
function describe_wake(wake: RunWake, context: WakeContext): string {
	const live = run_wake.is_supervisor_live(wake) ? 'running' : 'not running'
	const cuts = carry_cuts(run_carry.read_carry(context.carry_target))

	return [
		`invocation: ${wake.invocation}`,
		`profile: ${wake.profile === undefined ? 'unrecorded' : agent_role_profile.describe(wake.profile)}`,
		`supervisor: process ${String(wake.pid)} (${live}), watching since ${wake.started_at}`,
		`woke ${String(wake.woke)} session(s) across ${cuts} cut(s)`,
		outstanding_line(wake),
		run_liveness.describe_agent_state(context.log_target),
		`output: ${context.log_target}`,
		// How progress is seen without asking after the cut: the run's stream, followed from here
		// (joshuafolkken/kit#2207). `--list` is that reader's one-shot last-event form.
		...stream_lines(context),
		`stop it with \`${STOP_COMMAND}\``,
	]
		.filter((line) => line !== undefined)
		.join('\n')
}

const run_wake_describe = { STOP_COMMAND, describe_wake }

export type { WakeContext }
export { run_wake_describe }
