import { randomUUID } from 'node:crypto'
import { linkSync, statSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { agent_argv } from '#scripts/agent/agent-argv'
import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch, type LaunchArgv } from '#scripts/run/detached-launch'
import { run_cut, type RunCut } from '#scripts/run/run-cut'
import { z } from 'zod'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch_log } from './lane-dispatch-log'
import type { LaneInfo } from './lane-registry'
import { openai_lane_supervisor_decision } from './openai-lane-supervisor-decision'

const OWNER_PREFIX = 'josh-openai-lane-supervisor-'
const STATE_PREFIX = 'josh-openai-lane-supervisor-state-'
const CHILD_POLL_MS = 250
const CLAIM_POLL_MS = 50
const CLAIM_POLL_LIMIT = 40
const SUPERVISOR_SCRIPT = fileURLToPath(new URL('openai-lane-supervisor-cli.ts', import.meta.url))
const owner_schema = z.object({
	issue: z.string(),
	nonce: z.string(),
	pid: z.number().int().positive(),
	process_start: z.string().optional(),
})
const state_schema = z.object({
	owner_nonce: z.string(),
	child_pid: z.number().int().positive().optional(),
	child_process_start: z.string().optional(),
	epoch: z.number().int().nonnegative(),
})

type SupervisorOwner = z.infer<typeof owner_schema>
type SupervisorState = z.infer<typeof state_schema>

function marker_path(lane_directory: string): string {
	return stamp_file.stamp_path(OWNER_PREFIX, lane_directory)
}

function state_path(lane_directory: string): string {
	return stamp_file.stamp_path(STATE_PREFIX, lane_directory)
}

function parsed_stamp<T>(target: string, schema: z.ZodType<T>): T | undefined {
	try {
		const value: unknown = JSON.parse(stamp_file.read_stamp_text(target) ?? '')
		const parsed = schema.safeParse(value)

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

function read(lane_directory: string): SupervisorOwner | undefined {
	return parsed_stamp(marker_path(lane_directory), owner_schema)
}

function read_state(lane_directory: string, nonce: string): SupervisorState | undefined {
	const state = parsed_stamp(state_path(lane_directory), state_schema)

	return state?.owner_nonce === nonce ? state : undefined
}

function is_live(owner: SupervisorOwner): boolean {
	return process_identity.is_same_process(owner.pid, owner.process_start) !== false
}

function active(lane_directory: string): SupervisorOwner | undefined {
	const owner = read(lane_directory)

	return owner !== undefined && is_live(owner) ? owner : undefined
}

async function wait_for_active(lane_directory: string): Promise<SupervisorOwner | undefined> {
	for (let attempt = 0; attempt < CLAIM_POLL_LIMIT; attempt += 1) {
		const owner = active(lane_directory)
		if (owner !== undefined) return owner
		await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS))
	}

	return undefined
}

// The hard link snapshots the exact owner inode. Several contenders may snapshot one stale owner,
// but only one can unlink it; a contender arriving after a replacement sees different inodes and
// cannot remove the new live owner.
function remove_if_unchanged(target: string): void {
	const snapshot = `${target}.${String(process.pid)}.${randomUUID()}`

	try {
		linkSync(target, snapshot)
		const current = statSync(target)
		const linked = statSync(snapshot)
		if (current.dev === linked.dev && current.ino === linked.ino) unlinkSync(target)
	} catch {
		/* absence or replacement is resolved by the exclusive create below */
	} finally {
		stamp_file.remove_stamp(snapshot)
	}
}

interface ChildIdentity {
	pid: number
	process_start?: string
}

function live_child(state: SupervisorState | undefined): ChildIdentity | undefined {
	if (state?.child_pid === undefined) return undefined
	const { child_pid, child_process_start } = state

	if (process_identity.is_same_process(child_pid, child_process_start) === false) {
		return undefined
	}

	return {
		pid: child_pid,
		...(child_process_start !== undefined && { process_start: child_process_start }),
	}
}

function carried_child(
	lane_directory: string,
	owner: SupervisorOwner | undefined,
): ChildIdentity | undefined {
	if (owner === undefined) return undefined

	return live_child(read_state(lane_directory, owner.nonce))
}

function remove_stale_owner(target: string, previous: SupervisorOwner | undefined): boolean {
	if (previous !== undefined && is_live(previous)) return false
	if (stamp_file.read_stamp_text(target) !== undefined) remove_if_unchanged(target)

	return true
}

function claim(issue: string, lane_directory: string, nonce: string): SupervisorOwner | undefined {
	const target = marker_path(lane_directory)
	const previous = read(lane_directory)
	if (!remove_stale_owner(target, previous)) return undefined
	const child = carried_child(lane_directory, previous)
	const owner = { issue, nonce, ...process_identity.own_fields() }
	if (!stamp_file.create_stamp(target, owner)) return undefined
	stamp_file.replace_stamp(state_path(lane_directory), {
		owner_nonce: nonce,
		epoch: 0,
		...(child !== undefined && {
			child_pid: child.pid,
			...(child.process_start !== undefined && {
				child_process_start: child.process_start,
			}),
		}),
	})

	return owner
}

function update(lane_directory: string, owner: SupervisorOwner, state: SupervisorState): void {
	if (read(lane_directory)?.nonce !== owner.nonce) return
	stamp_file.replace_stamp(state_path(lane_directory), state)
}

function release(lane_directory: string, nonce: string): void {
	if (read(lane_directory)?.nonce !== nonce) return
	stamp_file.remove_stamp(state_path(lane_directory))
	stamp_file.remove_stamp(marker_path(lane_directory))
	openai_lane_supervisor_decision.remove(lane_directory, nonce)
}

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

function child_argv(lane: LaneInfo, profile: AgentProfile, is_resume: boolean): LaunchArgv {
	const invocation = is_resume
		? lane_child_invocation.resume_invocation(lane.issue)
		: lane_child_invocation.child_invocation(lane.issue)
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
			argv: child_argv(lane, profile, is_resume),
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
	const result = await run_child(generation)
	if (result.kind === LAUNCH_FAILED_KIND) return 1

	if ((await standing_cut(generation.lane.issue)) !== undefined) {
		return await run_generations({ ...generation, epoch: generation.epoch + 1, is_resume: true })
	}

	if (result.kind === 'abnormal') return 1

	return 0
}

async function wait_for_inherited_child(
	child_pid: number,
	child_process_start: string | undefined,
): Promise<void> {
	while (process_identity.is_same_process(child_pid, child_process_start) !== false) {
		await new Promise((resolve) => setTimeout(resolve, CHILD_POLL_MS))
	}
}

async function recovered_resume(lane: LaneInfo, nonce: string): Promise<boolean | undefined> {
	const child_pid = read_state(lane.directory, nonce)?.child_pid
	if (child_pid === undefined) return false
	await wait_for_inherited_child(child_pid, read_state(lane.directory, nonce)?.child_process_start)

	return (await standing_cut(lane.issue)) === undefined ? undefined : true
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

		return await run_claimed(lane, profile, owner)
	} finally {
		release(lane.directory, nonce)
	}
}

function supervisor_argv(issue: string, nonce: string): LaunchArgv {
	return { command: process.execPath, args: [...process.execArgv, SUPERVISOR_SCRIPT, issue, nonce] }
}

const openai_lane_supervisor = {
	active,
	approve: openai_lane_supervisor_decision.approve,
	cancel: openai_lane_supervisor_decision.cancel,
	claim,
	decision_path: openai_lane_supervisor_decision.target,
	marker_path,
	new_nonce: randomUUID,
	read,
	release,
	state_path,
	supervise,
	supervisor_argv,
	wait_for_active,
}

export { openai_lane_supervisor }
