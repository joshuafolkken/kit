import { agent_argv } from '#scripts/agent/agent-argv'
import { detached_launch, type LaunchResult } from '#scripts/run/detached-launch'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch_log } from './lane-dispatch-log'
import type { LaneInfo } from './lane-registry'

// Relaunching a lane child session into its own lane — a fresh agent process started detached, under
// the lane's stored profile at the effort of the phase it resumes into, logging to the lane's dispatch
// log and carrying the dispatch mark afresh. **It was `run:cut`'s alone until a second caller needed it**
// (joshuafolkken/kit#2428): the detached `josh ship` supervisor hands a stopped stage back to an agent
// the same way the pre-gate cut hands the gate to one, so the launch is shared rather than copied — the
// copy that drifts is the one that forgets the mark and is read as a person by every guard.
//
// The prompt is the caller's: each composes it from `lane-child-invocation.ts`, and every one of them
// ends with the bare `fullrun #<N>` so the parent's liveness poll keeps matching the relaunched process.

type RelaunchResult = LaunchResult | { kind: 'rejected'; note: string }

function relaunch(
	lane: LaneInfo,
	invocation: string,
	phase: string,
	on_note: (note: string) => void,
): RelaunchResult {
	const built = agent_argv.resume_argv(invocation, lane.profile, phase, lane.directory)

	if (built.kind === 'rejected') return built

	return detached_launch.launch(
		{
			argv: built.argv,
			cwd: lane.directory,
			log_path: lane_dispatch_log.default_log_path(lane),
			profile: built.profile,
			// The relaunch keeps the mark, so the resumed child is still a dispatched child to every rule
			// that reads it (joshuafolkken/kit#1904); the inherited environment cannot be relied on here,
			// since the parent-session strip runs on the way in.
			env: lane_child_marker.env_for(lane.issue),
		},
		on_note,
	)
}

const lane_relaunch = { relaunch }

export type { RelaunchResult }
export { lane_relaunch }
