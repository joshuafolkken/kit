import { repository_lock } from '#scripts/git/repository-lock'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_plan } from '#scripts/run/event/run-event-plan'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_child_marker, type MarkerSource } from './lane-child-marker'

const LOCK_WAIT_MS = 5000

// The `implement` phase a lane child reports to `run:board`. Every other phase
// is read off an event the run already writes — the launch, the ship stages — but nothing marked the
// moment the plan turned into code. The pretool hook marks the first runtime-file edit independently
// of the Step 0 notice, once per launch. The Step 0 work summary
// is where a plan settles, so the issue's `plan` event is written here first, unless `run:entry` already
// wrote it for a planned issue.
//
// **A dispatched lane child only.** A person's own session, or one carrying a mark leaked from a parent,
// is not a lane the board draws a row for, so it writes nothing.
function implement_text(issue: string): string {
	return `${issue_cite.plain_for('program', issue)} implement`
}

async function has_implement(issue: string): Promise<boolean> {
	const events = await run_event_stream_emit.invocation_or_all_events()

	return run_event_scope
		.since_own_launch(events, issue)
		.some(
			(event) =>
				event.kind === run_event_stream.EVENT_KIND.LANE_PHASE &&
				event.text === implement_text(issue),
		)
}

async function mark_once(issue: string): Promise<void> {
	if (await has_implement(issue)) return

	await run_event_plan.emit_plan(issue)
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.LANE_PHASE, implement_text(issue))
}

async function mark_implement(
	directory: string = process.cwd(),
	source: MarkerSource = process.env,
): Promise<void> {
	const issue = lane_child_marker.marked_issue(source)

	if (issue === undefined || !lane_child_marker.is_child_of(directory, source)) return
	// Serialize the read and both appends across parallel hook processes for this lane.
	await repository_lock.with_lock(
		async () => {
			await mark_once(issue)
		},
		repository_lock.lock_path(`josh-lane-phase-${issue}-`, directory),
		LOCK_WAIT_MS,
	)
}

const lane_phase = { mark_implement }

export { lane_phase }
