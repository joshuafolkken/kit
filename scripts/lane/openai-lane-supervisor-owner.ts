import { randomUUID } from 'node:crypto'
import { linkSync, statSync, unlinkSync } from 'node:fs'
import { process_identity } from '#scripts/josh/process-identity'
import { process_owner_schema } from '#scripts/josh/process-owner'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { openai_lane_supervisor_decision } from './openai-lane-supervisor-decision'

// The supervisor's owner and state stamps — who holds a lane, and which child it last launched —
// split out of `openai-lane-supervisor.ts` when it reached its line limit.
// `openai_lane_supervisor` re-exports each public one under the name it always had, so the move
// changed no call site and no suite that spies on `openai_lane_supervisor`.

const OWNER_PREFIX = 'josh-openai-lane-supervisor-'
const STATE_PREFIX = 'josh-openai-lane-supervisor-state-'
const CLAIM_POLL_MS = 50
const CLAIM_POLL_LIMIT = 40
// The shared owner pair, with the pid narrowed: this record is written only by a live supervisor, so a
// pid that is not a real one marks it as corrupt rather than as a dead owner.
const owner_schema = process_owner_schema.extend({
	issue: z.string(),
	nonce: z.string(),
	pid: z.number().int().positive(),
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
	return json_value.parse_with(stamp_file.read_stamp_text(target) ?? '', schema)
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
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
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

	if (process_identity.is_same_process(child_pid, child_process_start) === false) return undefined

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

const openai_lane_supervisor_owner = {
	active,
	claim,
	marker_path,
	read_state,
	release,
	state_path,
	update,
	wait_for_active,
}

export { openai_lane_supervisor_owner, type SupervisorOwner }
