import { setTimeout as sleep } from 'node:timers/promises'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { lane_child_invocation, type ShipStop } from '#scripts/lane/lane-child-invocation'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { ShipSection } from './run-ship'
import { run_ship_next, type ShipResume } from './run-ship-next'
import { run_ship_place } from './run-ship-place'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_relaunch_cap } from './run-ship-relaunch-cap'
import { run_ship_stage, type Stage } from './run-ship-stage'
import type { ShipArguments } from './run-ship-steps'
import { run_ship_stop_cause } from './run-ship-stop-cause'
import { run_ship_stop_context } from './run-ship-stop-context'
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
//    The relaunches are capped: past the cap the issue is parked and a person told instead.
//
// A ship run in an agent's own turn is not supervised and hands nothing back: its report is already in
// front of the agent that ran it.

const OPENAI_PROVIDER = 'openai'
// A minute of polling, long enough for the supervisor's 5-second lane scan to reopen a server.
const SERVING_POLL_MS = 1000
const SERVING_POLLS = 60

type ReturnOutcome = 'relaunched' | 'recorded' | 'parked' | 'redispatch'

function stop_text(issue: string, stage: Stage, resume: ShipResume, output: string): string {
	const reason = run_ship_stage.stop_reason(stage, resume.conflicts)
	const cause = run_ship_stop_cause.cause_of(stage, { ...resume, body: output })

	return run_ship_stop_text.format(issue, reason, cause)
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

function relaunched(lane: LaneInfo, stop: ShipStop): ReturnOutcome {
	const invocation = lane_child_invocation.ship_stop_invocation(lane.issue, stop)
	const phase = agent_role_profile.IMPLEMENTATION_PHASE
	const result = lane_relaunch.relaunch(lane, invocation, phase, note)

	if (result.kind === 'launched') return 'relaunched'

	note(`the lane child could not be relaunched: ${result.note}`)

	return 'recorded'
}

// **A served lane's child is relaunched by its broker, not from here**: this supervisor descends from the
// child's Bash tool, which Claude Code starts without the token, so a child started here could not sign
// in where the token is the only credential (joshuafolkken/kit#3817).
async function ask_broker(lane: LaneInfo, stop: ShipStop): Promise<boolean> {
	const answer = await lane_session_broker.request(lane.directory, lane.issue, {
		kind: 'relaunch',
		stop,
	})

	if (!answer.is_success) note(`the lane broker did not start the lane child — ${answer.reason}`)

	return answer.is_success
}

// The session of a broker serving the lane within the wait, other than `previous` — one that stopped
// serving is reopened by the supervisor's next lane scan (`claude-lane-broker.ts`).
async function await_server(lane: LaneInfo, previous?: string): Promise<string | undefined> {
	for (let polled = 0; polled < SERVING_POLLS; polled += 1) {
		const session = lane_session_broker.serving_session(lane.directory, lane.issue)
		if (session !== undefined && session !== previous) return session

		// eslint-disable-next-line no-await-in-loop -- polling: each check waits on the scan the previous one missed
		await sleep(SERVING_POLL_MS)
	}

	return undefined
}

// **A relaunch the broker failed is asked once more, of a new broker only, then handed to the driver**: a
// stop left recorded waited hours for the stall detector (joshuafolkken/kit#4344). The broker that failed
// may still be starting the first relaunch, so asking it again could start a second child beside it.
// Once this supervisor exits, the driver's next poll reads the stop as unanswered and re-dispatches the
// issue (`run-merge-ship.ts`).
async function brokered(lane: LaneInfo, stop: ShipStop, server: string): Promise<ReturnOutcome> {
	if (await ask_broker(lane, stop)) return 'relaunched'

	const next = await await_server(lane, server)

	if (next !== undefined && (await ask_broker(lane, stop))) return 'relaunched'

	note('the lane child could not be relaunched: the driver re-dispatches the issue')

	return 'redispatch'
}

// A child that stopped more often than the cap allows is parked instead of relaunched
// (`run-ship-relaunch-cap.ts`); a park the label refused leaves the stop recorded, as before.
async function parked(issue: string, stage: Stage, resume: ShipResume): Promise<ReturnOutcome> {
	const reason = run_ship_stage.stop_reason(stage, resume.conflicts)

	if (await run_ship_relaunch_cap.park(issue, reason)) return 'parked'

	note('the lane child was not relaunched past the ship-stop cap, and the park label was refused')

	return 'recorded'
}

// `output` is the failed stage's own output: the relaunched child's prompt carries its tail.
async function return_control(
	issue: string,
	stage: Stage,
	resume: ShipResume,
	output: string,
): Promise<ReturnOutcome> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.SHIP_STOP,
		stop_text(issue, stage, resume, output),
	)

	const lane = await lane_to_relaunch(issue)

	if (lane === undefined) return 'recorded'

	if (await run_ship_relaunch_cap.is_over(issue)) return await parked(issue, stage, resume)
	// A followup stop waits for a lane place, keeping the ship-stop prompt and the relaunch cap a driver
	// re-dispatch would lose (`run-ship-place.ts`).
	await run_ship_place.await_place(lane, stage)

	const stop = { stage, ...resume, context: await run_ship_stop_context.build(issue, output) }
	// **A broker that stopped serving before the stop is waited for**: one that died during the review left
	// the lane unserved at the stop, and a child started here cannot sign in on a token (joshuafolkken/kit#4344).
	const server = await await_server(lane)

	return server === undefined ? relaunched(lane, stop) : await brokered(lane, stop, server)
}

type FailedSection = Pick<ShipSection, 'body' | 'conflicts' | 'cause'>

// The section's conflicts and the cause its review round tagged, only where it has them.
function stopped_resume(resume: ShipResume, failed: FailedSection | undefined): ShipResume {
	const { conflicts, cause } = failed ?? {}

	return {
		...resume,
		...(conflicts !== undefined && { conflicts }),
		...(cause !== undefined && { cause }),
	}
}

// The stopped ship's arguments and its failed section, as `return_control` takes them: the section's
// conflicts and tagged cause ride on the resume, its body is the output the prompt carries. A stale
// review rides on it too, so the relaunched child re-detaches with `--review` (joshuafolkken/kit#4221).
async function hand_back(
	args: ShipArguments,
	stage: Stage,
	failed: FailedSection | undefined,
): Promise<ReturnOutcome> {
	const is_review_stale = await run_ship_probe.read_review_stale()
	const resume = { ...run_ship_next.resume_of(args), is_review_stale }

	return await return_control(
		args.number,
		stage,
		stopped_resume(resume, failed),
		failed?.body ?? '',
	)
}

const run_ship_return = { hand_back, return_control }

export type { ReturnOutcome }
export { run_ship_return }
