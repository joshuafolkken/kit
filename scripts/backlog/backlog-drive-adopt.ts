import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { DrivePorts, DriveState } from './backlog-drive'
import { backlog_drive_restore } from './backlog-drive-restore'

// **A lane the drive did not launch is still the run's to collect** (joshuafolkken/kit#4373). The loop
// held only the lanes it was seeded with and the ones it launched, so a child the parent dispatched
// itself with `lane:launch` — an interrupt in a named run — finished, merged and was never handed to
// `run:merge`: no `merge` event and no collected lane until `run:carry --end`. The
// stop was `run_pass` collecting only `state.in_flight` (`backlog-drive.ts`), seeded once at start
// (`backlog-drive-cli.ts` `seeded_lanes`). Adopted, a child that ends with its pull request unmerged
// is classified `failed` by `run:merge` (`run-merge.ts` `unfinished_outcome`), which puts it on the
// stream as a park with its cause (`run-merge-cli.ts` `on_parked_failure`) — the reason a lane left
// unmerged is recorded.

// The open lanes on a child this run launched and never settled — what the drive adopts while it runs
// and `run:carry --end` collects once it has stopped.
async function active_lanes(): Promise<ReadonlyArray<LaneInfo>> {
	const active = backlog_drive_restore.active_issues(await run_event_stream_emit.current_events())
	const lanes = await lane_registry.list_lanes()

	return lanes.filter((lane) => !lane.is_stranded && active.has(lane.issue))
}

function adopted_note(issue: string): string {
	return `${issue_cite.plain(issue)} adopted by backlog:drive: its lane was launched outside the loop`
}

async function note_adopted(issue: string): Promise<void> {
	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.NOTE, adopted_note(issue))
}

// The active lanes the loop does not hold, each put on the stream with why it is adopted.
async function adoptable(in_flight: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
	const lanes = await active_lanes()
	const issues = lanes.map((lane) => lane.issue).filter((issue) => !in_flight.includes(issue))

	await Promise.all(
		issues.map(async (issue) => {
			await note_adopted(issue)
		}),
	)

	return issues
}

// The state with every adoptable lane in flight, so its child is collected as soon as it ends. Asked on
// an offered pass only, not every poll: the read walks the run's whole event stream. A stopping run
// adopts nothing: the child whose unparked failure stopped it left the stream unsettled, so adopting
// would collect — and count — it again.
async function held(
	state: DriveState,
	should_offer: boolean,
	ports: Pick<DrivePorts, 'adoptable'>,
): Promise<DriveState> {
	if (!should_offer || state.is_stopping) return state

	const adopting = await ports.adoptable(state.in_flight)

	return adopting.length === 0 ? state : { ...state, in_flight: [...state.in_flight, ...adopting] }
}

const backlog_drive_adopt = { active_lanes, adoptable, held }

export { backlog_drive_adopt }
