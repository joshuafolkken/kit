import { agent_argv, type AgentArgv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { LabelWrite } from '#scripts/gh/git-gh-issue-write'
import { issue_cite } from '#scripts/issue/issue-cite'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ending } from '#scripts/run/run-ending'
import { run_label } from '#scripts/run/run-label'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch_log } from './lane-dispatch-log'
import { lane_ledger } from './lane-ledger'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_resume, type ResumePlan } from './lane-resume'
import { openai_lane_supervisor } from './openai-lane-supervisor'

// `josh lane:dispatch <issue-number>` — start a lane's child as an operating-system process of its own.
//
// **This is what makes the premise the session cut rests on true.** `backlogrun-progress.md` → "The
// hand-off" says "nothing has to finish, because nothing is being abandoned"; an in-process child
// would die with the parent it was cut from. Launched detached, the child survives the cut and the
// sentence holds as written.
//
// **Nothing here is new machinery.** The lane is already a linked work tree with its own branch and
// ports (`lane-open.ts`), the detached launcher is already `run:wake`'s (`detached-launch.ts`), and the
// recorded output path is already how a session that never opened a lane polls it (`lane-output.ts`).
// This is the one command that puts the three together.
//
// **The recording happens inside the dispatch, so "the lane records no path" is not a state.** A
// lane dispatched through here is recorded by the same call that starts it, so no run can forget it.

// The invocation the child is given. Composed from this constant and a digits-only issue number, never
// from text that was read from anywhere — the same discipline `run-wake-session.ts` applies to the
// invocation it rebuilds out of the carry record.
// The resume guide a relaunched child is pointed at. It carries the resume
// procedure a `run:cut` successor follows, so naming it lets the child read one section rather than the
// workflow-commands entry documents it would otherwise read to learn it is a resume at all.
const NOTE_SEPARATOR = '; '
const WARNING_TITLE = 'lane child dispatch'
const WARNING_RECOVERY =
	'Check the lane with `pnpm josh lane:list`, then run `pnpm josh lane:dispatch <issue-number>` again.'
// The discriminant for a dispatch refused because the `in-progress` marker could not be applied, named
// once rather than inlined at each use.
const LABEL_UNSET_KIND = 'label-unset'
// The role a lane child runs under, resolved once so the fresh and resume builders read the same one.
const RESOLVED_ROLE = agent_role_profile.WORKER

interface Dispatched {
	kind: 'dispatched'
	lane: LaneInfo
	invocation: string
	log_path: string
	pid: number
	profile: AgentProfile
	// The session id this dispatch resumed, or `undefined` when it started fresh.
	// `describe` reports which path was taken, so an `outage` re-dispatch says whether it recovered the
	// disconnected child's context or fell back to a fresh run.
	resumed_from: string | undefined
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
	| { kind: typeof LABEL_UNSET_KIND; reason: string }

type LogOutcome = { kind: 'ready'; path: string } | { kind: 'unrecordable'; reason: string }

interface StartRequest {
	lane: LaneInfo
	log_path: string
	invocation: string
	argv: AgentArgv
	profile: AgentProfile
	resumed_from: string | undefined
}

type Prepared =
	| {
			kind: 'prepared'
			invocation: string
			argv: AgentArgv
			profile: AgentProfile
			resumed_from: string | undefined
	  }
	| { kind: 'rejected'; note: string }

/** The prompt the headless child is given: `fullrun #<N>`, and nothing a caller supplied verbatim. */
function child_invocation(issue: string): string {
	return lane_child_invocation.child_invocation(issue)
}

/**
 * The prompt a relaunched child is given after a `run:cut` — a resume-specific instruction followed by
 * the bare `child_invocation`. Given the plain `fullrun #<N>`, a relaunched child would read the
 * workflow-commands entry documents every resume before it could learn it was a resume at all — the
 * "do not re-read" exception lives inside the very skill it would have to open. This preamble tells
 * it up front, so it goes straight to `run:cut --resume` and the stage that answers.
 *
 * **It ends with `child_invocation` on purpose, not as decoration.** The parent's liveness poll is
 * `lane_child_invocation.process_pattern` (read by `run:liveness` — see `log_sentence`), so a relaunched process
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

// The `dispatched` outcome, built from the request the launch was composed from — one place so the
// three launch paths cannot drift on which fields a dispatched child carries (the resume flag among
// them). The request's `argv` rides along harmlessly.
// **`kind` is written last on purpose**: the request was spread from a `Prepared`, so it still carries
// `kind: 'prepared'` at runtime, and letting the spread win would mislabel the outcome.
function dispatched_of(
	request: StartRequest,
	pid: number,
	notes: ReadonlyArray<string>,
): Dispatched {
	return { ...request, pid, notes, kind: 'dispatched' }
}

function existing_dispatch(request: StartRequest): DispatchOutcome | undefined {
	if (request.profile.provider !== 'openai') return undefined
	const active = openai_lane_supervisor.active(request.lane.directory)
	if (active?.issue !== request.lane.issue) return undefined

	if (!openai_lane_supervisor.approve(request.lane.directory, active.nonce)) {
		return failed_start(
			request,
			`the OpenAI supervisor for lane ${session_cite.issue(request.lane.issue)} was cancelled`,
			[],
		)
	}

	return dispatched_of(request, active.pid, [])
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
	const { lane } = request
	const owner = await openai_lane_supervisor.wait_for_active(lane.directory)

	if (owner?.issue !== lane.issue) {
		if (nonce !== undefined) openai_lane_supervisor.cancel(lane.directory, nonce)

		return failed_start(
			request,
			`the OpenAI supervisor did not claim lane ${session_cite.issue(lane.issue)}`,
			notes,
		)
	}

	if (!openai_lane_supervisor.approve(lane.directory, owner.nonce)) {
		return failed_start(
			request,
			`the OpenAI supervisor for lane ${session_cite.issue(lane.issue)} was cancelled`,
			notes,
		)
	}

	return dispatched_of(request, owner.pid, notes)
}

async function dispatched_start(
	request: StartRequest,
	pid: number,
	notes: ReadonlyArray<string>,
	nonce: string | undefined,
): Promise<DispatchOutcome> {
	return request.profile.provider === 'openai'
		? await openai_dispatched_start(request, notes, nonce)
		: dispatched_of(request, pid, notes)
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

// Build the argv the plan calls for: a resume carries the stored session id, a fresh start does not.
// Both run the same profile diagnostics under the already-resolved profile, so a resume is refused for
// exactly the reasons a fresh dispatch is.
function built_for(plan: ResumePlan, profile: AgentProfile, lane: LaneInfo): AgentArgvResult {
	if (plan.kind === 'resume') {
		return agent_argv.with_resume_in(plan.invocation, profile, plan.session_id, lane.directory)
	}

	return agent_argv.with_profile_in(plan.invocation, profile, lane.directory)
}

// **The re-dispatch decides resume-or-fresh from the lane's own exit record**.
// The record is read from the log the previous dispatch of this lane wrote — a first dispatch finds
// none and starts fresh, an `outage` ending with a session id resumes it. The provider is resolved
// first because the resume mechanism is Claude Code's, and an OpenAI lane falls back to fresh.
function prepared(lane: LaneInfo): Prepared {
	const resolved = agent_role_profile.resolve(RESOLVED_ROLE)

	if (resolved.kind === 'rejected') return resolved

	const record = run_ending.read_exit(default_log_path(lane))
	const plan = lane_resume.plan(lane.issue, record, resolved.profile.provider)
	const built = built_for(plan, resolved.profile, lane)

	if (built.kind === 'rejected') return built
	const resumed_from = plan.kind === 'resume' ? plan.session_id : undefined

	return {
		kind: 'prepared',
		invocation: plan.invocation,
		argv: built.argv,
		profile: built.profile,
		resumed_from,
	}
}

// **The parent claims the marker before it starts the child**, so the window in which a running child
// is uncounted closes at dispatch rather than tens of minutes later once the child's own `fullrun` gets
// to its (idempotent) apply. `issue_add_label` creates the label if the repository lacks it — a
// `POST /issues/{N}/labels` provisions a missing label with a generated color
// (`git-gh-issue-write.ts`) — so no separate `label_ensure` is needed here, and
// its unapplied answer is a real refusal to launch rather than a note — confirmed by a read-back, so
// a write that landed but answered with an error still launches.
async function mark_in_progress(issue: string): Promise<LabelWrite> {
	return await git_gh_command.issue_apply_label(issue, IN_PROGRESS_LABEL)
}

// A started child is recorded on the run's stream, which is where the stall detector ages the last
// dispatch from — unrecorded, every stall read "hours since the last dispatch"
// minutes after a launch. A failed start records nothing: no child is running. The marker is claimed
// first, so a refused one starts nothing.
//
// The dispatch owns both halves of the marker: it applied it, so a launch that never started takes it
// back off through `run_label.unmark`, leaving no `in-progress` on an issue nothing is running. That
// removal warns and never throws, so it cannot turn a launch failure into a thrown error.
//
// The lane ledger takes the same instant: `lane:stats` times a lane's implementation from it, and the
// stream is capped, so a period's earlier dispatches would be gone from there.
async function record_started(issue: string): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.CHILD_LAUNCH,
		`${issue_cite.plain(issue)} dispatched`,
	)
	await lane_ledger.record_dispatch(Number(issue))
}

async function finish_dispatch(issue: string, request: StartRequest): Promise<DispatchOutcome> {
	const mark = await mark_in_progress(issue)

	if (!mark.is_applied) return { kind: LABEL_UNSET_KIND, reason: mark.reason }
	const outcome = await started(request)

	const is_failed = outcome.kind === 'failed'

	await (is_failed ? run_label.unmark(issue) : record_started(issue))

	return outcome
}

/** Start `fullrun #<N>` detached in the lane for `#<N>`, recording where it writes as it does so. */
async function dispatch_child(issue: string): Promise<DispatchOutcome> {
	issue_number_shape.require_issue_number(issue)

	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return { kind: 'no-lane' }
	const built = prepared(lane)
	const log_path = default_log_path(lane)

	if (built.kind === 'rejected') return { kind: 'failed', lane, log_path, note: built.note }

	const log = await resolved_log(lane, built.profile)

	if (log.kind !== 'ready') return log

	return await finish_dispatch(issue, { lane, log_path: log.path, ...built })
}

// **A launch whose log could not be opened is still a launch, and the reader has to hear both halves.**
// The child is running — saying otherwise would send the caller to dispatch a second one into the same
// lane — but its output is going nowhere, so a message naming the path would point at a file that will
// never grow, and a poll of that file would book a working child as stopped.
function log_sentence(outcome: Dispatched, issue: string): string {
	// **`run:liveness` reads the child's process for itself**, with the shared
	// pattern that matches the child's own command line and a detached ship supervisor, so no parent
	// passes `alive` by hand for a child that crashed an hour ago.
	const poll = `run \`pnpm josh run:liveness ${issue} --output ${outcome.log_path}\` — it reads the child's process for itself`

	if (outcome.notes.length > 0) {
		return ` Its output is NOT being kept — ${outcome.notes.join(NOTE_SEPARATOR)} — so ${outcome.log_path} will not grow and the process trace is the only answer: ${poll}.`
	}

	return ` It writes to ${outcome.log_path}. To poll it, ${poll}.`
}

// Whether this dispatch resumed the disconnected child's session or started fresh — the report the
// `outage` re-dispatch owes. A fresh start says so too, so the absence of a
// resume is never silent when an outage record was present.
function resume_sentence(outcome: Dispatched): string {
	if (outcome.resumed_from === undefined) {
		return ' Started fresh — no resumable session was found in the lane record.'
	}

	return ` Resumed session ${outcome.resumed_from} — the disconnected child's context was recovered.`
}

// Never throws: it is reached from `warn_of_problem`, and a formatter that raised would lose the very
// message the warning exists to carry — the pid among it, with the child already running.
function describe(outcome: DispatchOutcome, issue: string): string {
	if (outcome.kind === 'no-lane') {
		return `No lane is open for ${session_cite.issue(issue)}. Run \`pnpm josh lane:open ${issue}\` first, then dispatch into it.`
	}

	if (outcome.kind === 'unrecordable') return outcome.reason

	if (outcome.kind === LABEL_UNSET_KIND) {
		return `The child for ${session_cite.issue(issue)} was not started: the \`${IN_PROGRESS_LABEL}\` label could not be applied (${outcome.reason}), so the lane would be counted as empty. Nothing was launched.`
	}

	if (outcome.kind === 'failed') {
		return `The child for ${session_cite.issue(issue)} did not start: ${outcome.note}. Its log is at ${outcome.log_path}.`
	}

	return `Dispatched \`${outcome.invocation}\` as process ${String(outcome.pid)} in ${outcome.lane.directory} with ${agent_role_profile.describe(outcome.profile)}.${resume_sentence(outcome)}${log_sentence(outcome, issue)}`
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
		issue_title: `${WARNING_TITLE} ${issue_cite.plain(issue)}`,
		body: describe(outcome, issue),
		recovery: WARNING_RECOVERY,
	})
}

const lane_dispatch = {
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
