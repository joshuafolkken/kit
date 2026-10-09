import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_plan } from '#scripts/run/event/run-event-plan'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_child_marker, type MarkerSource } from './lane-child-marker'

// The `implement` phase a lane child reports to `run:board`. Every other phase
// is read off an event the run already writes — the launch, the ship stages — but nothing marked the
// moment the plan turned into code. The first runtime-file edit is that moment, and the Step 0 notice
// already fires on it once per session, so the pretool hook calls this beside it. The Step 0 work summary
// is where a plan settles, so the issue's `plan` event is written here first, unless `run:entry` already
// wrote it for a planned issue.
//
// **A dispatched lane child only.** A person's own session, or one carrying a mark leaked from a parent,
// is not a lane the board draws a row for, so it writes nothing.
async function mark_implement(
	directory: string = process.cwd(),
	source: MarkerSource = process.env,
): Promise<void> {
	const issue = lane_child_marker.marked_issue(source)

	if (issue === undefined || !lane_child_marker.is_child_of(directory, source)) return

	await run_event_plan.emit_plan(issue)
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.LANE_PHASE,
		`${issue_cite.plain(issue)} implement`,
	)
}

const lane_phase = { mark_implement }

export { lane_phase }
