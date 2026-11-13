// A launch identity survives Codex's shell environment filtering without guessing its session PID.
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_headless_keys } from '#scripts/run/run-headless-keys'
import type { CarryOwner, RunCarry } from './run-carry'
import { run_carry_conversation } from './run-carry-conversation'

const KEY = 'JOSH_CARRY_SESSION'

function own(): string | undefined {
	if (
		lane_child_marker.marked_issue(process.env) !== undefined ||
		process.env[run_headless_keys.BESIDE_CHILD_KEY] === '1' ||
		process.env[run_headless_keys.HANDOFF_CHILD_KEY] === '1'
	) {
		return undefined
	}

	return process.env[KEY]
}

function is_owned_by(carry: RunCarry, owner: CarryOwner): boolean {
	if (carry.owner_session !== undefined) return carry.owner_session === owner.session
	if (run_carry_conversation.is_same_conversation(carry, owner)) return true

	return carry.owner_pid === owner.pid && carry.owner_start === owner.start
}

function retain_execution(carry: RunCarry, owner: CarryOwner): CarryOwner {
	if (
		owner.session === undefined ||
		owner.session !== carry.owner_session ||
		owner.pid !== undefined
	) {
		return owner
	}

	return {
		...owner,
		pid: carry.owner_pid,
		start: carry.owner_start,
		provider: carry.scheduler_provider,
		is_headless: carry.is_owner_headless,
	}
}

const run_carry_session = { KEY, own, is_owned_by, retain_execution }

export { run_carry_session }
