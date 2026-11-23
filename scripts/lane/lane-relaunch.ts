import { setTimeout } from 'node:timers/promises'
import { agent_argv } from '#scripts/agent/agent-argv'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { detached_launch, type LaunchResult } from '#scripts/run/detached-launch'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch_dependency } from './lane-dispatch-dependency'
import { lane_dispatch_log } from './lane-dispatch-log'
import { lane_reap } from './lane-reap'
import { lane_reap_settle } from './lane-reap-settle'
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
type Prepared = Exclude<Awaited<ReturnType<typeof agent_argv.resume_argv>>, { kind: 'rejected' }>

function launch_ready(
	lane: LaneInfo,
	built: Prepared,
	on_note: (note: string) => void,
): RelaunchResult {
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

// An OpenAI lane's process is started by its supervisor, never by a relaunch — both `run:cut` and the
// `run:merge` cut fallback ask this one predicate.
function is_openai_lane(lane: LaneInfo): boolean {
	return lane.profile?.provider === OPENAI_PROVIDER
}

// Whether the stopped child still runs once its exit handlers had the close's grace window.
async function outlived(issue: string): Promise<boolean> {
	if (!lane_reap.is_child_running(issue)) return false
	await setTimeout(lane_reap_settle.GRACE_MS, 0)

	return lane_reap.is_child_running(issue)
}

// joshuafolkken/kit#8843: a relaunch whose lane child still runs — a supervisor hand-off that judged a
// live stage stopped — would put a second child beside it in one tree, each running its own gate. The
// live child's tree goes first, by the reap `lane:restart` uses; one that outlives the SIGTERM refuses
// the launch. The caller's own ancestry is never matched, so `run:cut` from inside the child reaps
// nothing. **The lane's residents stay**, unlike a restart's: a broker relaunches on a detached ship
// supervisor's behalf, and that supervisor, its gate and any reviewer run from the lane outside the
// broker's ancestry. An OpenAI lane's liveness is its supervisor's, as `lane:dispatch` leaves it.
async function stop_previous(lane: LaneInfo): Promise<string | undefined> {
	if (is_openai_lane(lane) || !lane_reap.is_child_running(lane.issue)) return undefined

	lane_reap.reap_child(lane)
	if (!(await outlived(lane.issue))) return undefined
	const cited = session_cite.issue(lane.issue)

	return `The previous child for ${cited} still runs after a SIGTERM, so no second child was launched beside it.`
}

async function launch(
	lane: LaneInfo,
	built: Prepared,
	on_note: (note: string) => void,
): Promise<RelaunchResult> {
	const wait = await lane_dispatch_dependency.check(lane.issue)

	if (wait !== undefined) {
		await lane_dispatch_dependency.defer(lane.issue)

		return { kind: 'rejected', note: wait.reason }
	}

	const alive = await stop_previous(lane)

	if (alive !== undefined) return { kind: 'rejected', note: alive }
	await lane_dispatch_dependency.begin(lane.issue)

	return launch_ready(lane, built, on_note)
}

async function relaunch(
	lane: LaneInfo,
	invocation: string,
	phase: string,
	on_note: (note: string) => void,
): Promise<RelaunchResult> {
	try {
		// The labels are read only when `josh.worker` caps the phase's model; a failed read refuses.
		const built = await agent_argv.resume_argv(invocation, lane.profile, phase, {
			cwd: lane.directory,
			labels: async () => await git_gh_issue_write.read_label_names(lane.issue),
		})
		if (built.kind === 'rejected') return built

		return await lane_seat_start.start(lane, async (seated) => await launch(seated, built, on_note))
	} catch (error) {
		return { kind: 'failed', note: error_text.message_of(error) }
	}
}

// The relaunch after a cut: the resume-specific prompt, not the record's bare `fullrun #<N>`,
// so the successor goes straight to `run:entry` without reading the
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
