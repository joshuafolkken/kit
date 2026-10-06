import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { agent_argv } from '#scripts/agent/agent-argv'
import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import { process_identity } from '#scripts/josh/process-identity'
import { detached_launch, type LaunchArgv } from '#scripts/run/detached-launch'
import { run_cut, type RunCut } from '#scripts/run/run-cut'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch_log } from './lane-dispatch-log'
import type { LaneInfo } from './lane-registry'
import { openai_lane_ship } from './openai-lane-ship'
import { openai_lane_supervisor_decision } from './openai-lane-supervisor-decision'
import { openai_lane_supervisor_owner, type SupervisorOwner } from './openai-lane-supervisor-owner'
import { openai_review_broker } from './openai-review-broker'

const { claim, read_state, release, update } = openai_lane_supervisor_owner
const CHILD_POLL_MS = 250
const SUPERVISOR_SCRIPT = fileURLToPath(new URL('openai-lane-supervisor-cli.ts', import.meta.url))

function handed_off(cut: RunCut | undefined, issue: string): boolean {
	return (
		cut?.is_handed_off === true &&
		cut.issue === issue &&
		cut.invocation === run_cut.invocation_for(issue)
	)
}

async function standing_cut(issue: string): Promise<RunCut | undefined> {
	const git_directory = await run_cut.worktree_directory()
	if (git_directory === undefined) return undefined
	const read_cut = run_cut.read_cut(run_cut.cut_path(git_directory))

	return read_cut.kind === 'carried' && handed_off(read_cut.cut, issue) ? read_cut.cut : undefined
}

function child_argv(
	lane: LaneInfo,
	profile: AgentProfile,
	is_resume: boolean,
	override?: string,
): LaunchArgv {
	const invocation =
		override ??
		(is_resume
			? lane_child_invocation.resume_invocation(lane.issue)
			: lane_child_invocation.child_invocation(lane.issue))
	const built = agent_argv.with_profile_in(invocation, profile, lane.directory)
	if (built.kind === 'rejected') throw new Error(built.note)

	return built.argv
}

const LAUNCH_FAILED_KIND = 'launch-failed'
type ChildResult =
	| { kind: 'completed' }
	| { kind: 'abnormal'; note: string }
	| { kind: typeof LAUNCH_FAILED_KIND; note: string }

interface Generation {
	epoch: number
	is_resume: boolean
	lane: LaneInfo
	owner: SupervisorOwner
	profile: AgentProfile
	invocation?: string
}

function completion_code(result: ChildResult, ship: string): number {
	return ship === 'abnormal' || result.kind === 'abnormal' ? 1 : 0
}

function record_child(generation: Generation, child_pid: number): void {
	const { lane, owner, epoch } = generation
	const child_process_start = process_identity.read_start(child_pid)

	update(lane.directory, owner, {
		owner_nonce: owner.nonce,
		epoch,
		child_pid,
		...(child_process_start !== undefined && { child_process_start }),
	})
}

function child_result(
	result: Awaited<ReturnType<typeof detached_launch.launch_attached>>,
): ChildResult {
	if (result.kind === 'failed') return { kind: LAUNCH_FAILED_KIND, note: result.note }
	if (result.exit_code === 0) return { kind: 'completed' }
	const note = `OpenAI lane child exited abnormally (${String(result.exit_code)})`

	console.error(note)

	return { kind: 'abnormal', note }
}

async function run_child(generation: Generation): Promise<ChildResult> {
	const { lane, profile, is_resume } = generation
	const result = await detached_launch.launch_attached(
		{
			argv: child_argv(lane, profile, is_resume, generation.invocation),
			cwd: lane.directory,
			log_path: lane_dispatch_log.default_log_path(lane),
			profile,
			env: lane_child_marker.env_for(lane.issue),
		},
		(note) => {
			console.error(`OpenAI lane child launch: ${note}`)
		},
		(child_pid) => {
			record_child(generation, child_pid)
		},
	)

	return child_result(result)
}

async function run_generations(generation: Generation): Promise<number> {
	const prior = await openai_lane_ship.current(generation.lane.issue)
	const result = await run_child(generation)
	if (result.kind === LAUNCH_FAILED_KIND) return 1

	if ((await standing_cut(generation.lane.issue)) !== undefined) {
		return await run_generations({ ...generation, epoch: generation.epoch + 1, is_resume: true })
	}

	const ship = await openai_lane_ship.wait_for_ship(generation.lane.issue, prior?.launch_id)

	if (ship === 'failed') {
		return await run_generations({
			...generation,
			epoch: generation.epoch + 1,
			is_resume: false,
			invocation: lane_child_invocation.ship_stop_invocation(generation.lane.issue),
		})
	}

	return completion_code(result, ship)
}

async function wait_for_inherited_child(
	child_pid: number,
	child_process_start: string | undefined,
): Promise<void> {
	while (process_identity.is_same_process(child_pid, child_process_start) !== false) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await new Promise((resolve) => setTimeout(resolve, CHILD_POLL_MS))
	}
}

async function recovered_resume(lane: LaneInfo, nonce: string): Promise<boolean | undefined> {
	const child_pid = read_state(lane.directory, nonce)?.child_pid
	if (child_pid === undefined) return false
	await wait_for_inherited_child(child_pid, read_state(lane.directory, nonce)?.child_process_start)

	if ((await standing_cut(lane.issue)) === undefined) return undefined

	return true
}

async function run_claimed(
	lane: LaneInfo,
	profile: AgentProfile,
	owner: SupervisorOwner,
): Promise<number> {
	const is_recovered = await recovered_resume(lane, owner.nonce)
	if (is_recovered === undefined) return 0
	const is_resume = is_recovered || (await standing_cut(lane.issue)) !== undefined
	const epoch = (read_state(lane.directory, owner.nonce)?.epoch ?? 0) + 1

	return await run_generations({ lane, profile, owner, is_resume, epoch })
}

async function supervise(lane: LaneInfo, profile: AgentProfile, nonce: string): Promise<number> {
	const owner = claim(lane.issue, lane.directory, nonce)
	if (owner === undefined) return 0

	try {
		if (!(await openai_lane_supervisor_decision.is_approved(lane.directory, nonce))) return 0

		return await openai_review_broker.with_server(
			lane,
			async () => await run_claimed(lane, profile, owner),
		)
	} finally {
		release(lane.directory, nonce)
	}
}

function supervisor_argv(issue: string, nonce: string): LaunchArgv {
	return { command: process.execPath, args: [...process.execArgv, SUPERVISOR_SCRIPT, issue, nonce] }
}

const openai_lane_supervisor = {
	active: openai_lane_supervisor_owner.active,
	approve: openai_lane_supervisor_decision.approve,
	cancel: openai_lane_supervisor_decision.cancel,
	claim,
	marker_path: openai_lane_supervisor_owner.marker_path,
	new_nonce: randomUUID,
	release,
	state_path: openai_lane_supervisor_owner.state_path,
	supervise,
	supervisor_argv,
	wait_for_active: openai_lane_supervisor_owner.wait_for_active,
}

export { openai_lane_supervisor }
