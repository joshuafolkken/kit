import { agent_argv } from '#scripts/agent/agent-argv'
import { error_text } from '#scripts/lib/error-message'
import { detached_launch, type LaunchResult } from '#scripts/run/detached-launch'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch_log } from './lane-dispatch-log'
import type { LaneInfo } from './lane-registry'
import { lane_seat_start } from './lane-seat-start'

// Relaunching a lane child session into its own lane — a fresh agent process started detached, under
// the lane's stored profile at the effort (and any model override) of the phase it resumes into, logging to the lane's dispatch
// log and carrying the dispatch mark afresh. **It was `run:cut`'s alone until a second caller needed it**:
// the detached `josh ship` supervisor hands a stopped stage back to an agent
// the same way the pre-gate cut hands the gate to one, so the launch is shared rather than copied — the
// copy that drifts is the one that forgets the mark and is read as a person by every guard.
//
// The prompt is the caller's: each composes it from `lane-child-invocation.ts`, and every one of them
// ends with the bare `fullrun #<N>` so the parent's liveness poll keeps matching the relaunched process.

const { SUPERVISED_KEY } = run_ship_detach
const OPENAI_PROVIDER = 'openai'

type RelaunchResult = LaunchResult | { kind: 'rejected'; note: string }
type Prepared = Exclude<ReturnType<typeof agent_argv.resume_argv>, { kind: 'rejected' }>

function launch(lane: LaneInfo, built: Prepared, on_note: (note: string) => void): RelaunchResult {
	return detached_launch.launch(
		{
			argv: built.argv,
			cwd: lane.directory,
			log_path: lane_dispatch_log.default_log_path(lane),
			profile: built.profile,
			// The relaunch keeps the mark, so the resumed child is still a dispatched child to every rule
			// that reads it; the inherited environment cannot be relied on here,
			// since the parent-session strip runs on the way in. **The ship supervisor's mark is dropped**:
			// a detached supervisor is what relaunches after a stopped stage, and an
			// agent that inherited its mark would read its own in-turn `josh ship` failure as a supervisor's —
			// relaunching a second child into the lane beside itself.
			env: {
				...lane_child_marker.env_for(lane.issue),
				...lane_seat_start.environment(lane),
				[SUPERVISED_KEY]: undefined,
			},
		},
		on_note,
	)
}

async function relaunch(
	lane: LaneInfo,
	invocation: string,
	phase: string,
	on_note: (note: string) => void,
): Promise<RelaunchResult> {
	const built = agent_argv.resume_argv(invocation, lane.profile, phase, lane.directory)
	if (built.kind === 'rejected') return built

	try {
		return await lane_seat_start.start(lane, async (seated) => launch(seated, built, on_note))
	} catch (error) {
		return { kind: 'failed', note: error_text.message_of(error) }
	}
}

// An OpenAI lane's process is started by its supervisor, never by a relaunch — both `run:cut` and the
// `run:merge` cut fallback ask this one predicate.
function is_openai_lane(lane: LaneInfo): boolean {
	return lane.profile?.provider === OPENAI_PROVIDER
}

// The relaunch after a cut: the resume-specific prompt, not the record's bare `fullrun #<N>`,
// so the successor goes straight to `run:cut --resume` without reading the
// workflow-commands entry documents. Shared by `run:cut` and the `run:merge` fallback.
async function resume(
	lane: LaneInfo,
	phase: string,
	on_note: (note: string) => void,
): Promise<RelaunchResult> {
	return await relaunch(lane, lane_child_invocation.resume_invocation(lane.issue), phase, on_note)
}

const lane_relaunch = { is_openai_lane, relaunch, resume }

export type { RelaunchResult }
export { lane_relaunch }
