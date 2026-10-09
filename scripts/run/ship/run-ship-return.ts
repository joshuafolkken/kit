import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { lane_child_invocation } from '#scripts/lane/lane-child-invocation'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { ShipResume } from './run-ship-next'
import { run_ship_stage, type Stage } from './run-ship-stage'
import { run_ship_stop_text } from './run-ship-stop-text'

// How a detached `josh ship` supervisor hands a stopped stage back. The agent
// ended when it handed the region over, so a red gate, a High/Medium review, a failed push or red CI has
// nobody to read it — this is what gives it one, in two halves:
//
// 1. **A `ship-stop` position on the event stream**, naming the issue and the stage. `run:step` maps it to
//    the command that prints the stopped report, so whoever asks next is pointed at the failure rather
//    than rebuilding what happened.
// 2. **In a dispatched lane, a fresh child session relaunched into the lane** — the way the pre-gate cut
//    relaunches one (`lane-relaunch.ts`) — with the ship-stop prompt, at the implementation phase's
//    effort because a fix is judgement. It is started before the supervisor exits, so the parent's
//    liveness poll never sees the lane empty. An OpenAI lane is left to its own supervisor, which starts
//    no successor without a cut, so its parent books the stop exactly as it books any ended child.
//
// A ship run in an agent's own turn is not supervised and hands nothing back: its report is already in
// front of the agent that ran it.

const OPENAI_PROVIDER = 'openai'

type ReturnOutcome = 'relaunched' | 'recorded'

function stop_text(issue: string, stage: Stage, resume: ShipResume): string {
	return run_ship_stop_text.format(issue, run_ship_stage.stop_reason(stage, resume.conflicts))
}

function can_relaunch(lane: LaneInfo | undefined): lane is LaneInfo {
	return lane !== undefined && lane.profile?.provider !== OPENAI_PROVIDER
}

async function lane_to_relaunch(issue: string): Promise<LaneInfo | undefined> {
	if (!lane_child_marker.is_child_of(process.cwd())) return undefined

	const lane = await lane_registry.find_open_lane(issue)

	return can_relaunch(lane) ? lane : undefined
}

function note(text: string): void {
	process.stderr.write(`${text}\n`)
}

async function return_control(
	issue: string,
	stage: Stage,
	resume: ShipResume,
): Promise<ReturnOutcome> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.SHIP_STOP,
		stop_text(issue, stage, resume),
	)

	const lane = await lane_to_relaunch(issue)

	if (lane === undefined) return 'recorded'

	const invocation = lane_child_invocation.ship_stop_invocation(issue, { stage, ...resume })
	const result = lane_relaunch.relaunch(
		lane,
		invocation,
		agent_role_profile.IMPLEMENTATION_PHASE,
		note,
	)

	if (result.kind === 'launched') return 'relaunched'

	note(`the lane child could not be relaunched: ${result.note}`)

	return 'recorded'
}

const run_ship_return = { return_control }

export type { ReturnOutcome }
export { run_ship_return }
