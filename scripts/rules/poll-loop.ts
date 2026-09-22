import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'

// The trigger and the delivered text behind the `poll-loop` row of `delivered-rules.ts`
// (joshuafolkken/kit#2371). The hand-written wait loop a lane child improvises over a backgrounded
// command's output file.
//
// **The gap `early-heartbeat` left, on purpose.** joshuafolkken/kit#1570's rule refuses a bare
// `sleep` — a clock timer arming a progress report — and it stands down the moment it sees a loop
// keyword (`early-heartbeat.ts`'s `LOOP_KEYWORD`), because a loop that ends on a condition is waiting
// on a thing rather than on a clock. This is that thing: a `while`/`until` loop that sleeps between
// probes of a command's output file. It never appeared in the heartbeat reading, and it is the larger
// half of the waste — six lanes lost about 45 minutes, 13% of their wall clock, to it.
//
// **The loop does not know when the command finished.** A regex over the output file that never
// matches waits to the harness block limit; one that matches a mid-run line exits too early. Either
// way the command's *exit* is not what ends the wait, and each pass spends a full-context round trip.
// A command backgrounded with `run_in_background` re-invokes the run when it exits — the completion
// notification is what ends the wait on the task itself, which is the mechanism this row hands back,
// the same reading joshuafolkken/kit#1510 took for the foreground push (`run-tail.ts`).
//
// **It fires on every occurrence**, for the reason `git-force.ts` does: a poll loop wastes the same
// round trips each time it is armed, so refused-once-and-free-after would put every loop but the first
// back on the run's self-restraint — the thing that let these loops through in the first place.

// A `while` or `until` header, in either spelling a poll loop reaches for. The trailing whitespace is
// what separates the keyword from a path that merely begins with it (`until.txt`); a `for` loop is out
// by omission — it iterates a fixed list rather than probing a state.
const LOOP_KEYWORD = /\b(?:while|until)\s/u
// A `sleep` command with any argument — the pause between probes that makes a loop a poll rather than
// a stream reader. Read anywhere in the line rather than at a command position, because the loop body
// puts it behind a `do` keyword (`; do sleep 30; done`), which no separator precedes. The argument is
// matched as any non-space rather than a digit, so a variable duration (`sleep "$INTERVAL"`) is caught
// as a literal one is — a poll with a configurable interval is still a poll (joshuafolkken/kit#2371,
// review round 1).
const SLEEP_COMMAND = /\bsleep\s+\S/u
// **A `while read … done < file` is a stream reader, not a poll**, even when its body sleeps to
// throttle processing (joshuafolkken/kit#2371, review round 1). Its condition consumes input rather
// than probing for a state, so the completion notification this rule points to has nothing to do with
// it. It is excluded unless an `until` header is also present — a line carrying both is a poll that
// merely quotes `read` somewhere, and the `until` is the tell.
const STREAM_READER = /\bwhile\s+read\b/u
const UNTIL_HEADER = /\buntil\s/u

function is_stream_reader(plain: string): boolean {
	return STREAM_READER.test(plain) && !UNTIL_HEADER.test(plain)
}

// **Quoted spans are blanked first, and here that is load-bearing rather than tidy.** This
// repository's Issue bodies and commit messages quote these very loops constantly — this Issue's own
// body does — so without the blanking `gh issue comment <N> --body "… until grep …; do sleep …; done"`
// would read as the poll loop it only describes. `time_shell.unquoted` is the one removal shared with
// every other trigger, so two readers of one command cannot disagree about a quoting form.
function is_poll_loop(command: string): boolean {
	const plain = time_shell.unquoted(command)

	if (is_stream_reader(plain)) return false

	return LOOP_KEYWORD.test(plain) && SLEEP_COMMAND.test(plain)
}

// The instruction in the shape a refusal can carry: what the loop is about to cost, why the command's
// exit is the thing to wait on, and the one route that delivers that exit. The measurement is named
// because it is what makes the rule believable — six lanes, about 45 minutes, 13% of their wall clock.
const POLL_LOOP_REASON =
	"⛔ output poll loop: this hand-writes a `while`/`until` … `sleep` loop over a command's output " +
	'file, and the loop does not know when the command finished. A regex that never matches waits to ' +
	'the harness block limit; one that matches a mid-run line exits too early — either way the ' +
	'command exit is not what ends the wait, and each pass spends a full-context round trip ' +
	'(joshuafolkken/kit#2371 measured about 45 minutes, 13% of six lanes, lost to exactly this). Do ' +
	'not poll the output file. A command known to take minutes — `pnpm josh gate`, `pnpm josh ' +
	'followup`, `pnpm josh format` — is started detached from the first with `run_in_background` set, ' +
	'and the harness re-invokes you when it exits: its completion notification is what ends the wait, ' +
	'on the task exit rather than a regex or the block limit. So issue the long command in the ' +
	'background and end the turn — do not arm a loop; the wake-up brings you back. To glance at ' +
	'interim output, `Read` the output file once, never in a sleep loop. If you are waiting on CI, ' +
	'`pnpm josh followup` waits on it for you. The procedure is ' +
	'`.claude/skills/workflow-commands/background-commands.md`, "A command that can take minutes is ' +
	'issued in the background". **This rule fires on every occurrence, not once per run.**'

// The row itself, so `delivered-rules.ts` spreads one entry. `decide` returns true so it refuses every
// occurrence; it declares no `keeps` — waiting on the task exit is the *absence* of a loop, not a
// call, so the row is reported unmeasured rather than scored on an act that does not exist
// (`git-force.ts`).
const ROW = {
	id: 'poll-loop',
	is_trigger: bash_triggers.on_bash_command(is_poll_loop),
	reason: POLL_LOOP_REASON,
	decide: (): boolean => true,
}

const poll_loop = {
	POLL_LOOP_REASON,
	ROW,
	is_poll_loop,
}

export { poll_loop }
