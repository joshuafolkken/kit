import { repository_lock } from '#scripts/git/repository-lock'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_plan } from '#scripts/run/event/run-event-plan'
import { run_event_resume } from '#scripts/run/event/run-event-resume'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold_live } from '#scripts/run/hold/run-hold-live'
import { lane_child_marker, type MarkerSource } from './lane-child-marker'
import { lane_reap } from './lane-reap'

const LOCK_WAIT_MS = 5000

// The `implement` phase a lane child reports to `run:board`. Every other phase
// is read off an event the run already writes — the launch, the ship stages — but nothing marked the
// moment the plan turned into code. The pretool hook marks the first runtime-file edit independently
// of the Step 0 notice, once per launch and once more per resume. The Step 0 work summary
// is where a plan settles, so the issue's `plan` event is written here first, unless `run:entry` already
// wrote it for a planned issue.
//
// **A run only:** a dispatched lane child, or a run in the root checkout that holds the tree — an edit
// under its hold's session (joshuafolkken/kit#8922). A person's own session, or one carrying a mark
// leaked from a parent, is not a run the board draws a row for, so it writes nothing.
const IMPLEMENT_SUFFIX = ' implement'

function implement_text(issue: string): string {
	return `${issue_cite.plain_for('program', issue)}${IMPLEMENT_SUFFIX}`
}

function is_implement_event(event: RunEvent): boolean {
	return (
		event.kind === run_event_stream.EVENT_KIND.LANE_PHASE && event.text.endsWith(IMPLEMENT_SUFFIX)
	)
}

// A resume back into implementation. A gate resume re-arms nothing: its progress is the ship launch, and
// an edit after it would redraw a running ship as implementing.
function is_implementation_resume(event: RunEvent, issue: string): boolean {
	return run_event_resume.is_resume_of(event, issue) && !run_event_resume.is_gate_resume(event)
}

// The current session's events: since its launch, or since its implementation resume, so a resumed
// session marks its own first edit (`lane:stats` → `resume → progress`, joshuafolkken/kit#8583).
function since_own_session(
	events: ReadonlyArray<RunEvent>,
	issue: string,
): ReadonlyArray<RunEvent> {
	const attempt = run_event_scope.since_own_launch(events, issue)
	const resume = attempt.findLastIndex((event) => is_implementation_resume(event, issue))

	return attempt.slice(resume + 1)
}

async function has_implement(issue: string): Promise<boolean> {
	const events = await run_event_stream_emit.invocation_or_all_events()

	return since_own_session(events, issue).some(
		(event) => is_implement_event(event) && event.text === implement_text(issue),
	)
}

async function mark_once(issue: string): Promise<void> {
	if (await has_implement(issue)) return

	await run_event_plan.emit_plan(issue)
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.LANE_PHASE, implement_text(issue))
}

// A dispatched lane child's issue, else the issue of the run whose live hold's session the editing
// process runs under (`run-hold-live.ts`).
function run_issue_of(
	directory: string,
	source: MarkerSource,
	ancestry: () => ReadonlySet<number>,
): string | undefined {
	const issue = lane_child_marker.marked_issue(source)

	if (issue !== undefined && lane_child_marker.is_child_of(directory, source)) return issue

	return run_hold_live.held_by(directory, ancestry)
}

async function mark_implement(
	directory: string,
	source: MarkerSource = process.env,
	ancestry: () => ReadonlySet<number> = lane_reap.own_ancestry,
): Promise<void> {
	const issue = run_issue_of(directory, source, ancestry)

	if (issue === undefined) return
	// Serialize the read and both appends across parallel hook processes for this lane.
	await repository_lock.with_lock(
		async () => {
			await mark_once(issue)
		},
		repository_lock.lock_path(`josh-lane-phase-${issue}-`, directory),
		LOCK_WAIT_MS,
	)
}

const lane_phase = { is_implement_event, mark_implement }

export { lane_phase }
