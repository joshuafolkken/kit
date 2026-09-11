import { telegram_notify } from '#scripts/git/telegram-notify'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_issue_number } from '#scripts/run/run-issue-number'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'

// `josh lane:dispatch <issue-number>` — start a lane's child as an operating-system process of its own
// (joshuafolkken/kit#1749).
//
// **The premise the session cut rests on was not true, and this is what makes it true.** A delegated
// child used to be an in-process subagent of the parent session, so cutting the parent killed every
// child still implementing: `epicrun.md` → "The hand-off" says "nothing has to finish, because nothing
// is being abandoned", and what actually happened was that the next session polled a file whose writer
// was dead, waited out the silent-unit window, booked each lane `stopped`, and aborted the whole run on
// the third one. Launched detached, the child survives the cut and the sentence holds as written.
//
// **Nothing here is new machinery.** The lane is already a linked work tree with its own branch and
// ports (`lane-open.ts`), the detached launcher is already `run:wake`'s (`detached-launch.ts`), and the
// recorded output path is already how a session that never opened a lane polls it (`lane-output.ts`).
// What was missing was the one command that puts the three together.
//
// **The recording happens inside the dispatch, so "the lane records no path" stops being a state.**
// `epicrun.md`'s hand-off has an exception for a lane nobody could poll, and it exists because the
// recording used to be a separate step a run could forget. A lane dispatched through here is recorded
// by the same call that starts it.

// The invocation the child is given. Composed from this constant and a digits-only issue number, never
// from text that was read from anywhere — the same discipline `run-wake-session.ts` applies to the
// invocation it rebuilds out of the carry record.
const CHILD_INVOCATION = 'fullrun'
const LOG_PREFIX = 'josh-lane-dispatch-'
const LOG_SUFFIX = '.log'
const NOTE_SEPARATOR = '; '
const WARNING_TITLE = 'lane child dispatch'
const WARNING_RECOVERY =
	'Check the lane with `pnpm josh lane:list`, then run `pnpm josh lane:dispatch <issue-number>` again.'

interface Dispatched {
	kind: 'dispatched'
	lane: LaneInfo
	invocation: string
	log_path: string
	pid: number
	// What the launcher reported while starting the child. **A launch can succeed with notes**, and
	// that combination is the one this field exists for: `detached_launch.launch` treats a log it could
	// not open as a reason to lose the diagnosis rather than a reason not to start the session, so the
	// child runs with its output discarded and only these notes say so.
	notes: ReadonlyArray<string>
}

type DispatchOutcome =
	| Dispatched
	| { kind: 'failed'; lane: LaneInfo; log_path: string; note: string }
	| { kind: 'no-lane' }
	| { kind: 'unrecordable'; reason: string }

type LogOutcome = { kind: 'ready'; path: string } | { kind: 'unrecordable'; reason: string }

/** The prompt the headless child is given: `fullrun #<N>`, and nothing a caller supplied verbatim. */
function child_invocation(issue: string): string {
	run_issue_number.require_issue_number(issue)

	return `${CHILD_INVOCATION} #${issue}`
}

// **In the temp directory rather than in the lane**, so the log survives `pnpm josh lane:close` — the
// question a failed child raises is asked after its lane is gone. `lane_output.record_output` refuses
// anything `run:liveness` could not read, and the temp directory is one of the two trees it allows.
//
// **Keyed to the lane's directory, not to the issue number alone.** Issue numbers are per repository
// and an epic may span several, so `kit#12` and `app-kit#12` dispatched on one machine would otherwise
// append to one file — their transcripts interleaved, and each child's writes keeping the other's log
// growing, so a poll would read a dead child as alive. It is `run:wake`'s own log-naming rather than a
// second scheme: `stamp_file.stamp_path` takes the prefix, the root the record is keyed to, and the
// suffix. The issue number stays in the prefix so a person can still find the file by eye.
function default_log_path(lane: LaneInfo): string {
	return stamp_file.stamp_path(`${LOG_PREFIX}${lane.issue}-`, lane.directory, LOG_SUFFIX)
}

// **The dispatch owns the log, so it writes to its own path rather than to whatever was recorded.**
// `pnpm josh lane:output <N> <path>` accepts any path under the home or temp directory, and what the
// older flow recorded there was the *unit's own transcript* — a file to read. Appending a launch header
// and the child's raw output into one would corrupt exactly the file `run:liveness` then parses. The
// derived path is the same for every dispatch of a lane, so re-dispatching appends a second header to
// the file it already owns rather than starting a new one somewhere else.
async function resolved_log(lane: LaneInfo): Promise<LogOutcome> {
	const outcome = await lane_output.record_output(lane.issue, default_log_path(lane))

	if (outcome.kind === 'recorded') return { kind: 'ready', path: outcome.output }

	return { kind: 'unrecordable', reason: lane_output.describe_refusal(outcome, lane.issue) }
}

// The notes the launcher reports are collected rather than printed: one of them arrives
// asynchronously, from the child-process `error` event, and a launch that failed has to say everything
// it knows in one message.
function started(lane: LaneInfo, log_path: string): DispatchOutcome {
	const notes: Array<string> = []
	const invocation = child_invocation(lane.issue)
	const result = detached_launch.launch(
		{ argv: detached_launch.agent_argv(invocation), cwd: lane.directory, log_path },
		(note) => {
			notes.push(note)
		},
	)

	if (result.kind !== 'launched') {
		return { kind: 'failed', lane, log_path, note: [result.note, ...notes].join(NOTE_SEPARATOR) }
	}

	return { kind: 'dispatched', lane, invocation, log_path, pid: result.pid, notes }
}

/** Start `fullrun #<N>` detached in the lane for `#<N>`, recording where it writes as it does so. */
async function dispatch_child(issue: string): Promise<DispatchOutcome> {
	run_issue_number.require_issue_number(issue)

	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return { kind: 'no-lane' }

	const log = await resolved_log(lane)

	if (log.kind !== 'ready') return log

	return started(lane, log.path)
}

// **A launch whose log could not be opened is still a launch, and the reader has to hear both halves.**
// The child is running — saying otherwise would send the caller to dispatch a second one into the same
// lane — but its output is going nowhere, so a message naming the path would point at a file that will
// never grow, and a poll of that file would book a working child as stopped.
function log_sentence(outcome: Dispatched, issue: string): string {
	// **The process trace is what a poll now turns on, so the message names the command that reads
	// it.** `run:liveness` takes `--process` as what the caller *saw*, never as a property of the
	// child's kind — told to pass `alive`, a parent that never ran `pgrep` would answer `alive` for a
	// child that crashed an hour ago and poll it for ever.
	const poll = `run \`pgrep -laf ${outcome.lane.directory}\` and pass what it found to \`pnpm josh run:liveness ${issue} --output ${outcome.log_path} --process alive\` — or \`--process none\` where it found nothing`

	if (outcome.notes.length > 0) {
		return ` Its output is NOT being kept — ${outcome.notes.join(NOTE_SEPARATOR)} — so ${outcome.log_path} will not grow and the process trace is the only answer: ${poll}.`
	}

	return ` It writes to ${outcome.log_path}. To poll it, ${poll}.`
}

// Never throws: it is reached from `warn_of_problem`, and a formatter that raised would lose the very
// message the warning exists to carry — the pid among it, with the child already running.
function describe(outcome: DispatchOutcome, issue: string): string {
	if (outcome.kind === 'no-lane') {
		return `No lane is open for #${issue}. Run \`pnpm josh lane:open ${issue}\` first, then dispatch into it.`
	}

	if (outcome.kind === 'unrecordable') return outcome.reason

	if (outcome.kind === 'failed') {
		return `The child for #${issue} did not start: ${outcome.note}. Its log is at ${outcome.log_path}.`
	}

	return `Dispatched \`${outcome.invocation}\` as process ${String(outcome.pid)} in ${outcome.lane.directory}.${log_sentence(outcome, issue)}`
}

/**
 * Whether this outcome is one nobody would otherwise hear about.
 *
 * **A dispatch that started a child with nowhere to write is one of them**, which is why this is not
 * simply `kind !== 'dispatched'`. It exits zero, because the child is running; what it must not do is
 * exit zero *silently*, leaving an operator to poll a file the launcher already said it could not open.
 */
function is_worth_warning(outcome: DispatchOutcome): boolean {
	return outcome.kind !== 'dispatched' || outcome.notes.length > 0
}

// **A dispatch that went wrong is the case with nobody watching**, which is the whole reason the
// warning channel exists: the parent that issued it may already have been cut, and a lane that never
// started its child looks exactly like a lane whose child is still thinking. The notifier reports its
// own failures to standard error and never throws, so this cannot turn a refusal into an exception.
async function warn_of_problem(outcome: DispatchOutcome, issue: string): Promise<void> {
	await telegram_notify.warn({
		issue_title: `${WARNING_TITLE} #${issue}`,
		body: describe(outcome, issue),
		recovery: WARNING_RECOVERY,
	})
}

const lane_dispatch = {
	CHILD_INVOCATION,
	child_invocation,
	default_log_path,
	describe,
	dispatch_child,
	is_worth_warning,
	warn_of_problem,
}

export type { DispatchOutcome }
export { lane_dispatch }
