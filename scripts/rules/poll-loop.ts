import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { early_heartbeat } from './early-heartbeat'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `poll-loop` row of `delivered-rules.ts`.
// The hand-written wait loop a lane child improvises over a backgrounded
// command's output file.
//
// **The gap `early-heartbeat` left, on purpose.** That rule refuses a bare
// `sleep` — a clock timer arming a progress report — and it stands down the moment it sees a loop
// keyword (`early-heartbeat.ts`'s `LOOP_KEYWORD`), because a loop that ends on a condition is waiting
// on a thing rather than on a clock. This is that thing: a `while`/`until` loop that sleeps between
// probes of a command's output file.
//
// **The loop does not know when the command finished.** A regex over the output file that never
// matches waits to the harness block limit; one that matches a mid-run line exits too early. Either
// way the command's *exit* is not what ends the wait, and each pass spends a full-context round trip.
// A command backgrounded with `run_in_background` re-invokes the run when it exits — the completion
// notification is what ends the wait on the task itself, which is the mechanism this row hands back,
// the same reading `run-tail-rule.ts` takes for the foreground push.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does: a poll loop wastes the same
// round trips each time it is armed, so refused-once-and-free-after would put every loop but the first
// back on the run's self-restraint — the thing that let these loops through in the first place.

// A `while` or `until` header, in either spelling a poll loop reaches for. The trailing whitespace is
// what separates the keyword from a path that merely begins with it (`until.txt`).
const LOOP_KEYWORD = /\b(?:while|until)\s/u
// A `sleep` command with any argument — the pause between probes that makes a loop a poll rather than
// a stream reader. Read anywhere in the line rather than at a command position, because the loop body
// puts it behind a `do` keyword (`; do sleep 30; done`), which no separator precedes. The argument is
// matched as any non-space rather than a digit, so a variable duration (`sleep "$INTERVAL"`) is caught
// as a literal one is — a poll with a configurable interval is still a poll.
const SLEEP_COMMAND = /\bsleep\s+\S/u
// **A loop with no `sleep` is still a poll — a worse one**. A lane child ran
// `until [ -f /tmp/gate-done ]; do if ! kill -0 %1 …; then break; fi; done` for hours: a busy-wait
// that spun a core on a marker nobody wrote, and slipped through because the rule required the
// `sleep`. Two headers make a loop a poll with or without one. An `until` header waits for a state to
// appear by definition — the keyword has no stream-reading or counting use. A `while` header whose
// condition *probes* a state — a file test, a process probe, a quiet `grep` — is the same wait
// spelled negatively. A `while` that counts or reads (`while [ "$i" -lt 5 ]`, `while read`) is not.
// Both are read at a command position only — the start of the line, after a separator, or after a
// keyword that opens a command list — because without `sleep` there is nothing else to tell a loop
// header from the word in an argument: `git log --until yesterday` is not a loop (review round 1).
const COMMAND_POSITION = String.raw`(?:^|[;&|({\n]|\b(?:do|then|else)\s)\s*`
const UNTIL_HEADER = new RegExp(String.raw`${COMMAND_POSITION}until\s`, 'u')
const WHILE_HEADER = String.raw`${COMMAND_POSITION}while\s+(?:!\s*)?`
const PROBE_HEADERS: ReadonlyArray<RegExp> = [
	String.raw`\[\[?\s+(?:!\s*)?-[defs]\s`,
	String.raw`test\s+(?:!\s*)?-[defs]\s`,
	String.raw`(?:kill\s+-0|pgrep)\b`,
	String.raw`grep\s+-[A-Za-z]*q`,
].map((probe) => new RegExp(`${WHILE_HEADER}${probe}`, 'u'))

// **A counted `for` that sleeps is a poll with a deadline** (joshuafolkken/kit#4800). A lane child
// waited out a backgrounded reviewer with `for i in $(seq 1 30); do sleep 10; done`, and the
// completion notification sat queued until the loop returned — the same held-back exit a `while` poll
// costs, spelled as a count. A header that counts — `$(seq …)`, a `{1..N}` range, or `((…))` — has no
// list to work through, so its `sleep` is the whole point. A `for` over a real list (`for f in *.ts`)
// is ordinary work and passes, sleep or not. The `sleep` is read in the loop's body only — from the
// header to its first `done` — so a counted loop beside an unrelated `sleep` is not a wait (review
// round 1); a nested loop's inner `done` cuts the body short, which under-refuses and so fails safe.
const COUNTED_FOR = new RegExp(
	String.raw`${COMMAND_POSITION}for(?:\s*\(\(|\s+\w+\s+in\s+(?:\$\(\s*seq\b|\{\d+\.\.))`,
	'u',
)
const THROUGH_FIRST_DONE = /^[\s\S]*?\bdone\b/u

// **A sleep chain in front of a read is the same poll, unrolled** (joshuafolkken/kit#5115). A lane
// child watched a backgrounded task with `sleep 20; sleep 20; sleep 20; tail -c 1500 …/x.output` and
// `sleep 20; ps -p 123`: no loop keyword, so the rows above miss it, and a read segment makes it
// work rather than a bare timer, so `early-heartbeat` stands down. Its sleep is only there for the
// read after it, which the completion notification makes unnecessary. The call is cut where the shell
// starts a program (`shell_segments.commands_of`), and every cut is a sleep, an inert marker
// (`early-heartbeat`'s own reading of both), or a read of a file or a process — at least one read,
// which is what keeps it disjoint from `early-heartbeat`'s bare timer. A short settle (`sleep 3; tail`)
// is below the threshold and passes.
const SETTLE_SECONDS = 10
const NO_SECONDS = 0
const READ_COMMAND = /^(?:tail|cat|head|ps|stat|grep|wc|ls|pgrep|test|kill\s+-0|\[\[?)(?=\s|$)/u

function slept_seconds(segments: ReadonlyArray<string>): number {
	return segments.reduce(
		(total, segment) => total + (early_heartbeat.sleep_seconds(segment) ?? NO_SECONDS),
		NO_SECONDS,
	)
}

// Only the sleep in front of the first read counts: `tail x; sleep 20` reads first and waits after,
// which is not a wait *for* the read.
function is_sleep_then_read(plain: string): boolean {
	const segments = shell_segments.commands_of(plain).filter((segment) => segment !== '')
	const first_work = segments.findIndex((segment) => !early_heartbeat.is_wait_or_inert(segment))
	const waited = first_work === -1 ? NO_SECONDS : slept_seconds(segments.slice(0, first_work))

	if (waited < SETTLE_SECONDS) return false

	return segments
		.slice(first_work)
		.every((segment) => early_heartbeat.is_wait_or_inert(segment) || READ_COMMAND.test(segment))
}

function is_state_wait(plain: string): boolean {
	return UNTIL_HEADER.test(plain) || PROBE_HEADERS.some((header) => header.test(plain))
}

function is_counted_sleep(plain: string): boolean {
	const header = COUNTED_FOR.exec(plain)

	if (header === null) return false

	const rest = plain.slice(header.index)

	return SLEEP_COMMAND.test(THROUGH_FIRST_DONE.exec(rest)?.[0] ?? rest)
}

function is_sleeping_loop(plain: string): boolean {
	return (LOOP_KEYWORD.test(plain) && SLEEP_COMMAND.test(plain)) || is_counted_sleep(plain)
}

// **A `while read … done < file` is a stream reader, not a poll**, even when its body sleeps to
// throttle processing. Its condition consumes input rather
// than probing for a state — a poll never reads its condition, it *tests* it (grep, wc, a file check)
// — so the completion notification this rule points to has nothing to do with it. A `while read`
// header is therefore always a stream reader; a line that also carried a separate `until` poll would
// go un-refused, which fails safe (under-refusal) and is contrived enough not to warrant the added
// regex the attempt to catch it needs.
const STREAM_READER = /\bwhile\s+read\b/u

function is_stream_reader(plain: string): boolean {
	return STREAM_READER.test(plain)
}

// **Quoted spans are blanked first, and here that is load-bearing rather than tidy.** This
// repository's Issue bodies and commit messages quote these very loops constantly — this Issue's own
// body does — so without the blanking `gh issue comment <N> --body "… until grep …; do sleep …; done"`
// would read as the poll loop it only describes. `time_shell.unquoted` is the one removal shared with
// every other trigger, so two readers of one command cannot disagree about a quoting form.
function is_poll_loop(command: string): boolean {
	const plain = time_shell.unquoted(command)

	if (is_stream_reader(plain)) return false
	if (is_state_wait(plain)) return true

	return is_sleeping_loop(plain) || is_sleep_then_read(plain)
}

// The instruction in the shape a refusal can carry: why the command's exit is the thing to wait on,
// and the one route that delivers that exit. The measurement behind it is in
// `docs/maintainers/rule-delivery-rationale.md`.
const POLL_LOOP_REASON =
	'⛔ output poll loop: a `while`/`until` or counted `for` loop, or a `sleep` chain before a read, ' +
	'does not know when the task finished. `run_in_background` and end the turn — its exit ' +
	're-invokes you; a background `Agent` is waited on by its completion notification (lane child: ' +
	'bare `sleep 20`, `pnpm josh run:liveness`); CI by `pnpm josh followup` ' +
	'(`background-commands.md`). Fires on every occurrence.'

// The row itself, so `delivered-rules.ts` spreads one entry. `decide` returns true so it refuses every
// occurrence; it declares no `keeps` — waiting on the task exit is the *absence* of a loop, not a
// call, so the row is reported unmeasured rather than scored on an act that does not exist
// (`git-force.ts`).
const ROW = {
	id: 'poll-loop',
	is_trigger: bash_triggers.on_bash_command(is_poll_loop),
	reason: POLL_LOOP_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Output poll loop',
		topic: '`.claude/skills/workflow-commands/background-commands.md`',
		fires:
			"a hand-written `while` / `until` wait loop over a command's output, a marker file or a process, a counted `for` that sleeps, or a `sleep` chain of 10 s or more before a read of a file or process. Every occurrence",
		quiet: 'the command started with `run_in_background` — its exit ends the wait',
	},
}

const poll_loop = {
	POLL_LOOP_REASON,
	ROW,
	is_poll_loop,
}

export { poll_loop }
