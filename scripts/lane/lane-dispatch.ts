import { agent_argv, type AgentArgv } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { IN_PROGRESS_LABEL } from '#scripts/git/issue-labels'
import { telegram_notify } from '#scripts/git/telegram-notify'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_issue_number } from '#scripts/run/run-issue-number'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch_log } from './lane-dispatch-log'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'
import { openai_lane_supervisor } from './openai-lane-supervisor'

// `josh lane:dispatch <issue-number>` — start a lane's child as an operating-system process of its own
// (joshuafolkken/kit#1749).
//
// **The premise the session cut rests on was not true, and this is what makes it true.** A delegated
// child used to be an in-process subagent of the parent session, so cutting the parent killed every
// child still implementing: `backlogrun-progress.md` → "The hand-off" says "nothing has to finish, because nothing
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
// `backlogrun.md`'s hand-off has an exception for a lane nobody could poll, and it exists because the
// recording used to be a separate step a run could forget. A lane dispatched through here is recorded
// by the same call that starts it.

// The invocation the child is given. Composed from this constant and a digits-only issue number, never
// from text that was read from anywhere — the same discipline `run-wake-session.ts` applies to the
// invocation it rebuilds out of the carry record.
// The resume guide a relaunched child is pointed at (joshuafolkken/kit#2022). It carries the resume
// procedure a `run:cut` successor follows, so naming it lets the child read one section rather than the
// workflow-commands entry documents it would otherwise read to learn it is a resume at all.
const NOTE_SEPARATOR = '; '
const WARNING_TITLE = 'lane child dispatch'
const WARNING_RECOVERY =
	'Check the lane with `pnpm josh lane:list`, then run `pnpm josh lane:dispatch <issue-number>` again.'
// The discriminant for a dispatch refused because the `in-progress` marker could not be applied, named
// once rather than inlined at each use.
const LABEL_UNSET_KIND = 'label-unset'

interface Dispatched {
	kind: 'dispatched'
	lane: LaneInfo
	invocation: string
	log_path: string
	pid: number
	profile: AgentProfile
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
	// The `in-progress` label could not be applied, so the child was not started. It is `in-progress`
	// that marks a child as holding its lane — the lane count, the offer filter, `run:progress` and the
	// stale check all read it — so a child that ran without it would be counted as an empty lane and
	// handed to a second session. Refusing the launch keeps "dispatched" and "counted as busy" one state.
	| { kind: typeof LABEL_UNSET_KIND }

type LogOutcome = { kind: 'ready'; path: string } | { kind: 'unrecordable'; reason: string }

interface StartRequest {
	lane: LaneInfo
	log_path: string
	invocation: string
	argv: AgentArgv
	profile: AgentProfile
}

type Prepared =
	| { kind: 'prepared'; invocation: string; argv: AgentArgv; profile: AgentProfile }
	| { kind: 'rejected'; note: string }

/** The prompt the headless child is given: `fullrun #<N>`, and nothing a caller supplied verbatim. */
function child_invocation(issue: string): string {
	return lane_child_invocation.child_invocation(issue)
}

/**
 * The prompt a relaunched child is given after a `run:cut` — a resume-specific instruction followed by
 * the bare `child_invocation` (joshuafolkken/kit#2022). A relaunched child used to be given the plain
 * `fullrun #<N>`, so it read the workflow-commands entry documents (SKILL.md, fullrun.md, ~29k tokens)
 * every resume before it could learn it was a resume at all — the "do not re-read" exception lives
 * inside the very skill it had to open. This preamble tells it up front, so it goes straight to
 * `run:cut --resume` and the stage that answers.
 *
 * **It ends with `child_invocation` on purpose, not as decoration.** The parent's liveness poll is
 * `pgrep -laf "<child_invocation>$"` (built at dispatch — see `log_sentence`), so a relaunched process
 * whose command line did not end with `fullrun #<N>` would be booked stopped while it ran. The trailing
 * invocation keeps that poll matching and is also the ordinary run a `fresh` verdict falls back to.
 */
function resume_invocation(issue: string): string {
	return lane_child_invocation.resume_invocation(issue)
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
	return lane_dispatch_log.default_log_path(lane)
}

// **The dispatch owns the log, so it writes to its own path rather than to whatever was recorded.**
// `pnpm josh lane:output <N> <path>` accepts any path under the home or temp directory, and what the
// older flow recorded there was the *unit's own transcript* — a file to read. Appending a launch header
// and the child's raw output into one would corrupt exactly the file `run:liveness` then parses. The
// derived path is the same for every dispatch of a lane, so re-dispatching appends a second header to
// the file it already owns rather than starting a new one somewhere else.
async function resolved_log(lane: LaneInfo, profile: AgentProfile): Promise<LogOutcome> {
	const outcome = await lane_output.record_output(lane.issue, default_log_path(lane), profile)

	if (outcome.kind === 'recorded') return { kind: 'ready', path: outcome.output }

	return { kind: 'unrecordable', reason: lane_output.describe_refusal(outcome, lane.issue) }
}

// The notes the launcher reports are collected rather than printed: one of them arrives
// asynchronously, from the child-process `error` event, and a launch that failed has to say everything
// it knows in one message.
function failed_start(
	request: StartRequest,
	note: string,
	notes: ReadonlyArray<string>,
): DispatchOutcome {
	return {
		kind: 'failed',
		lane: request.lane,
		log_path: request.log_path,
		note: [note, ...notes].join(NOTE_SEPARATOR),
	}
}

function existing_dispatch(request: StartRequest): DispatchOutcome | undefined {
	if (request.profile.provider !== 'openai') return undefined
	const active = openai_lane_supervisor.active(request.lane.directory)
	if (active?.issue !== request.lane.issue) return undefined

	if (!openai_lane_supervisor.approve(request.lane.directory, active.nonce)) {
		return failed_start(
			request,
			`the OpenAI supervisor for lane #${request.lane.issue} was cancelled`,
			[],
		)
	}

	return { kind: 'dispatched', ...request, pid: active.pid, notes: [] }
}

function launch_argv(request: StartRequest, nonce: string | undefined): AgentArgv {
	if (request.profile.provider !== 'openai') return request.argv
	if (nonce === undefined) throw new Error('OpenAI supervisor nonce is missing')

	return openai_lane_supervisor.supervisor_argv(request.lane.issue, nonce)
}

async function openai_dispatched_start(
	request: StartRequest,
	notes: ReadonlyArray<string>,
	nonce: string | undefined,
): Promise<DispatchOutcome> {
	const { lane, log_path, invocation, profile } = request
	const owner = await openai_lane_supervisor.wait_for_active(lane.directory)

	if (owner?.issue !== lane.issue) {
		if (nonce !== undefined) openai_lane_supervisor.cancel(lane.directory, nonce)

		return failed_start(request, `the OpenAI supervisor did not claim lane #${lane.issue}`, notes)
	}

	if (!openai_lane_supervisor.approve(lane.directory, owner.nonce)) {
		return failed_start(
			request,
			`the OpenAI supervisor for lane #${lane.issue} was cancelled`,
			notes,
		)
	}

	return { kind: 'dispatched', lane, invocation, log_path, pid: owner.pid, profile, notes }
}

async function dispatched_start(
	request: StartRequest,
	pid: number,
	notes: ReadonlyArray<string>,
	nonce: string | undefined,
): Promise<DispatchOutcome> {
	const { lane, log_path, invocation, profile } = request

	return profile.provider === 'openai'
		? await openai_dispatched_start(request, notes, nonce)
		: { kind: 'dispatched', lane, invocation, log_path, pid, profile, notes }
}

async function started(request: StartRequest): Promise<DispatchOutcome> {
	const notes: Array<string> = []
	const existing = existing_dispatch(request)
	if (existing !== undefined) return existing
	const nonce =
		request.profile.provider === 'openai' ? openai_lane_supervisor.new_nonce() : undefined
	const result = detached_launch.launch(
		{
			argv: launch_argv(request, nonce),
			cwd: request.lane.directory,
			log_path: request.log_path,
			profile: request.profile,
			env: lane_child_marker.env_for(request.lane.issue),
		},
		(note) => {
			notes.push(note)
		},
	)

	if (result.kind !== 'launched') return failed_start(request, result.note, notes)

	return await dispatched_start(request, result.pid, notes, nonce)
}

function prepared(lane: LaneInfo): Prepared {
	const invocation = child_invocation(lane.issue)
	const built = agent_argv.resolve_in(invocation, agent_role_profile.WORKER, lane.directory)

	return built.kind === 'rejected'
		? built
		: { kind: 'prepared', invocation, argv: built.argv, profile: built.profile }
}

// **The parent claims the marker before it starts the child**, so the window in which a running child
// is uncounted closes at dispatch rather than tens of minutes later once the child's own `fullrun` gets
// to its (idempotent) apply. `issue_add_label` creates the label if the repository lacks it — a
// `POST /issues/{N}/labels` provisions a missing label with a generated color (measured on
// joshuafolkken/kit#1026, `git-gh-issue-write.ts`) — so no separate `label_ensure` is needed here, and
// its `false` is a real refusal to launch rather than a note.
async function mark_in_progress(issue: string): Promise<boolean> {
	return await git_gh_command.issue_add_label(issue, IN_PROGRESS_LABEL)
}

// The dispatch owns both halves of the marker: it applied it, so a launch that never started takes it
// back off, leaving no `in-progress` on an issue nothing is running. A removal that itself fails is
// swallowed — the failed launch is already warned about, and `lane:list` / `run:progress` surface a
// stuck marker — so this never turns a launch failure into a thrown error.
async function unmark_in_progress(issue: string): Promise<void> {
	try {
		await git_gh_command.issue_remove_label(issue, IN_PROGRESS_LABEL)
	} catch {
		/* the launch already failed and is warned about; a stuck marker is reported by lane:list */
	}
}

async function finish_dispatch(issue: string, request: StartRequest): Promise<DispatchOutcome> {
	const outcome = await started(request)

	if (outcome.kind === 'failed') await unmark_in_progress(issue)

	return outcome
}

/** Start `fullrun #<N>` detached in the lane for `#<N>`, recording where it writes as it does so. */
async function dispatch_child(issue: string): Promise<DispatchOutcome> {
	run_issue_number.require_issue_number(issue)

	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return { kind: 'no-lane' }
	const built = prepared(lane)
	const log_path = default_log_path(lane)

	if (built.kind === 'rejected') return { kind: 'failed', lane, log_path, note: built.note }

	const log = await resolved_log(lane, built.profile)

	if (log.kind !== 'ready') return log

	if (!(await mark_in_progress(issue))) return { kind: LABEL_UNSET_KIND }

	return await finish_dispatch(issue, { lane, log_path: log.path, ...built })
}

// **A launch whose log could not be opened is still a launch, and the reader has to hear both halves.**
// The child is running — saying otherwise would send the caller to dispatch a second one into the same
// lane — but its output is going nowhere, so a message naming the path would point at a file that will
// never grow, and a poll of that file would book a working child as stopped.
function log_sentence(outcome: Dispatched, issue: string): string {
	// **The pattern matches the child's own command line, not the lane it runs in**
	// (joshuafolkken/kit#1948). The child is `claude … ${outcome.invocation}` and its argv carries no
	// path, so `pgrep -laf <lane directory>` found nothing for a living child and a poll booked it
	// stopped. The invocation is the last argument, so it sits at the end of the command line; the `$`
	// anchor is what keeps `fullrun #12` from matching a running `fullrun #123`. `run:liveness` takes
	// `--process` as what the caller *saw*, never as a property of the child's kind — told to pass
	// `alive`, a parent that never ran `pgrep` would answer `alive` for a child that crashed an hour ago
	// and poll it for ever.
	const poll = `run \`pgrep -laf "${outcome.invocation}$"\` and pass what it found to \`pnpm josh run:liveness ${issue} --output ${outcome.log_path} --process alive\` — or \`--process none\` where it found nothing`

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

	if (outcome.kind === LABEL_UNSET_KIND) {
		return `The child for #${issue} was not started: the \`${IN_PROGRESS_LABEL}\` label could not be applied, so the lane would be counted as empty. Nothing was launched.`
	}

	if (outcome.kind === 'failed') {
		return `The child for #${issue} did not start: ${outcome.note}. Its log is at ${outcome.log_path}.`
	}

	return `Dispatched \`${outcome.invocation}\` as process ${String(outcome.pid)} in ${outcome.lane.directory} with ${agent_role_profile.describe(outcome.profile)}.${log_sentence(outcome, issue)}`
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
	CHILD_INVOCATION: lane_child_invocation.CHILD_INVOCATION,
	child_invocation,
	default_log_path,
	describe,
	dispatch_child,
	is_worth_warning,
	resume_invocation,
	warn_of_problem,
}

export type { DispatchOutcome }
export { lane_dispatch }
