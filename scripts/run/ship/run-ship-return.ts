import { setTimeout as sleep } from 'node:timers/promises'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { lane_child_invocation, type ShipStop } from '#scripts/lane/lane-child-invocation'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_wake_driver } from '#scripts/run/wake/run-wake-driver'
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
// The wait for a broker on older code to be replaced: its refusal makes its supervisor reload onto the
// current code at its next pass boundary (`run-wake-code.ts`, joshuafolkken/kit#4714), which a pass reaches
// after a driver window and the pause between passes; a minute more covers the takeover and the
// successor's first lane scan. A driver that reruns a busy merge holds the pass longer still, and a ship
// past the wait is re-dispatched with the version mismatch named.
const RELOAD_POLLS =
	(run_wake_driver.WINDOW_MS + backlog_budget.OFFER_INTERVAL_MS) / SERVING_POLL_MS + SERVING_POLLS
const VERSION_MISMATCH_NOTE =
	'the lane broker runs older code than this ship (a version mismatch), and no broker on the current code read the request within the wait'

type ReturnOutcome = 'relaunched' | 'recorded' | 'parked' | 'redispatch'

// `unreadable`: the broker's code predates the request's shape, so it refused the request unread and
// started nothing.
type BrokerReply = 'started' | 'unreadable' | 'failed'

// The failed stage's output, and its standard output alone where the stage kept it apart.
type StageOutput = Pick<ShipSection, 'body' | 'out'>

function stop_text(issue: string, stage: Stage, resume: ShipResume, output: StageOutput): string {
	const reason = run_ship_stage.stop_reason(stage, resume.conflicts)
	const cause = run_ship_stop_cause.cause_of(stage, { ...resume, ...output })

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
async function ask_broker(lane: LaneInfo, stop: ShipStop): Promise<BrokerReply> {
	const answer = await lane_session_broker.request(lane.directory, lane.issue, {
		kind: 'relaunch',
		stop,
	})

	if (answer.is_success) return 'started'

	note(`the lane broker did not start the lane child — ${answer.reason}`)

	return lane_session_broker.is_unreadable(answer) ? 'unreadable' : 'failed'
}

// The session of a broker serving the lane within `polls` seconds, other than `previous` — one that stopped
// serving is reopened by the supervisor's next lane scan (`claude-lane-broker.ts`).
async function await_server(
	lane: LaneInfo,
	previous?: string,
	polls = SERVING_POLLS,
): Promise<string | undefined> {
	for (let polled = 0; polled < polls; polled += 1) {
		const session = lane_session_broker.serving_session(lane.directory, lane.issue)
		if (session !== undefined && session !== previous) return session

		// eslint-disable-next-line no-await-in-loop -- polling: each check waits on the scan the previous one missed
		await sleep(SERVING_POLL_MS)
	}

	return undefined
}

function polls_after(reply: BrokerReply): number {
	return reply === 'unreadable' ? RELOAD_POLLS : SERVING_POLLS
}

function redispatch_note(reply: BrokerReply): string {
	const cause = reply === 'unreadable' ? `${VERSION_MISMATCH_NOTE}: ` : ''

	return `the lane child could not be relaunched: ${cause}the driver re-dispatches the issue`
}

// **A relaunch the broker failed is asked once more, of a new broker only, then handed to the driver**: a
// stop left recorded waited hours for the stall detector (joshuafolkken/kit#4344). The broker that failed
// may still be starting the first relaunch, so asking it again could start a second child beside it.
// Once this supervisor exits, the driver's next poll reads the stop as unanswered and re-dispatches the
// issue (`run-merge-ship.ts`). A broker that could not read the request runs older code than this ship
// (joshuafolkken/kit#4733): its successor on the current code is waited for over a whole supervisor pass, and a
// re-dispatch past that wait names the version mismatch.
async function brokered(lane: LaneInfo, stop: ShipStop, server: string): Promise<ReturnOutcome> {
	const reply = await ask_broker(lane, stop)
	if (reply === 'started') return 'relaunched'

	const next = await await_server(lane, server, polls_after(reply))
	// The reply the issue is handed to the driver on: the new broker's where one served the lane.
	const last = next === undefined ? reply : await ask_broker(lane, stop)
	if (last === 'started') return 'relaunched'

	note(redispatch_note(last))

	return 'redispatch'
}

// A child that stopped more often than the cap allows is parked instead of relaunched
// (`run-ship-relaunch-cap.ts`); a park the label refused leaves the stop recorded, as before.
async function parked(issue: string, reason: string): Promise<ReturnOutcome> {
	if (await run_ship_relaunch_cap.park(issue, reason)) return 'parked'

	note('the lane child was not relaunched past the ship-stop cap, and the park label was refused')

	return 'recorded'
}

// `output` is the failed stage's own output: the relaunched child's prompt carries the body's tail, and
// the stop is classified on its standard output (`run-ship-stop-cause.ts`).
async function stopped(
	issue: string,
	stage: Stage,
	resume: ShipResume,
	output: StageOutput,
): Promise<ReturnOutcome> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.SHIP_STOP,
		stop_text(issue, stage, resume, output),
	)

	const lane = await lane_to_relaunch(issue)

	if (lane === undefined) return 'recorded'

	const reason = run_ship_stage.stop_reason(stage, resume.conflicts)

	if (await run_ship_relaunch_cap.is_over(issue, reason)) return await parked(issue, reason)
	// A followup stop waits for a lane place, keeping the ship-stop prompt and the relaunch cap a driver
	// re-dispatch would lose (`run-ship-place.ts`).
	await run_ship_place.await_place(lane, stage)

	const context = await run_ship_stop_context.build(issue, output.body)
	const stop = { stage, ...resume, context }
	// **A broker that stopped serving before the stop is waited for**: one that died during the review left
	// the lane unserved at the stop, and a child started here cannot sign in on a token (joshuafolkken/kit#4344).
	const server = await await_server(lane)

	return server === undefined ? relaunched(lane, stop) : await brokered(lane, stop, server)
}

async function return_control(
	issue: string,
	stage: Stage,
	resume: ShipResume,
	output: string,
): Promise<ReturnOutcome> {
	return await stopped(issue, stage, resume, { body: output })
}

type FailedSection = Pick<ShipSection, 'body' | 'out' | 'conflicts' | 'cause'>

// The section's conflicts and the cause its review round tagged, only where it has them.
function stopped_resume(resume: ShipResume, failed: FailedSection | undefined): ShipResume {
	const { conflicts, cause } = failed ?? {}

	return {
		...resume,
		...(conflicts !== undefined && { conflicts }),
		...(cause !== undefined && { cause }),
	}
}

// The stopped ship's arguments and its failed section, as `stopped` takes them: the section's conflicts
// and tagged cause ride on the resume, its body and standard output are the stage's output. A stale
// review rides on it too, so the relaunched child re-detaches with `--review` (joshuafolkken/kit#4221).
async function hand_back(
	args: ShipArguments,
	stage: Stage,
	failed: FailedSection | undefined,
): Promise<ReturnOutcome> {
	const is_review_stale = await run_ship_probe.read_review_stale()
	const resume = { ...run_ship_next.resume_of(args), is_review_stale }

	return await stopped(args.number, stage, stopped_resume(resume, failed), failed ?? { body: '' })
}

const run_ship_return = { hand_back, return_control }

export type { ReturnOutcome }
export { run_ship_return }
