import { statSync } from 'node:fs'
import { agent_event, type AgentEventState } from '#scripts/agent/agent-event'
import type { AgentProfile } from '#scripts/agent/agent-profile-schema'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_wake } from './run-wake'
import type { WakeContext } from './run-wake-describe'

// New launches keep a generation-specific result, so a triage or an older turn cannot finish one.
function log_path(context: WakeContext, id: string, profile: AgentProfile): string {
	return profile.provider === 'openai' ? `${context.log_target}.${id}` : context.log_target
}

function legacy_pid(context: WakeContext, invocation: string): number | undefined {
	const wake = run_wake.read_wake(context.wake_target)
	if (wake?.invocation !== invocation) return undefined

	return wake.woke_pid
}

function execution(context: WakeContext, carry: RunCarry): RunCarry {
	if (carry.owner_pid !== undefined || carry.owner_session !== undefined) return carry

	return { ...carry, owner_pid: legacy_pid(context, carry.invocation) }
}

function modified_at(target: string): number {
	try {
		return statSync(target).mtimeMs
	} catch {
		return 0
	}
}

// Legacy logs are shared: only the last launch, written through this wake's mark, can be evidence.
function launched_at(output: string): number {
	const header = output.split('\n').findLast((line) => line.startsWith('=== '))

	return Date.parse(header?.slice('=== '.length).split(' · ', 1)[0] ?? '')
}

function is_legacy_result(context: WakeContext, output: string): boolean {
	const wake = run_wake.read_wake(context.wake_target)
	const marked = Date.parse(wake?.woke_at ?? '')
	const launched = launched_at(output)

	return (
		launched <= marked &&
		marked - launched < run_wake.WAKE_GRACE_MS &&
		modified_at(context.log_target) >= marked
	)
}

function result_of(context: WakeContext, carry: RunCarry): AgentEventState {
	const target =
		carry.owner_session === undefined
			? context.log_target
			: `${context.log_target}.${carry.owner_session}`
	const output = stamp_file.read_stamp_text(target) ?? ''
	const is_usable = carry.owner_session !== undefined || is_legacy_result(context, output)

	return agent_event.read(is_usable ? output : '')
}

function is_judgment(carry: RunCarry): boolean {
	return (
		carry.scheduler_provider === 'openai' &&
		carry.is_owner_headless === true &&
		carry.is_handed_off !== true
	)
}

function judgment(context: WakeContext): RunCarry | undefined {
	const read = run_carry.read_carry(context.carry_target)

	return read.kind === 'carried' && is_judgment(read.carry) ? read.carry : undefined
}

function is_running(carry: RunCarry): boolean {
	return process_identity.is_same_process(carry.owner_pid, carry.owner_start) !== false
}

function hand_back(context: WakeContext, carry: RunCarry): CarryRead {
	const wake = run_wake.read_wake(context.wake_target)
	if (wake !== undefined) run_wake.update_wake(context.wake_target, run_wake.count_claim(wake))
	const next = run_carry.apply_change(context.carry_target, carry, { cuts: 1 })

	run_event_setup.emit_to(context.event_target, run_event_setup.STAGE.HANDING_OFF, new Date())

	return { kind: 'carried', carry: next }
}

function read_carry(context: WakeContext): CarryRead {
	const read = run_carry.read_carry(context.carry_target)

	if (read.kind !== 'carried' || !is_judgment(read.carry)) return read
	const carry = execution(context, read.carry)
	if (is_running(carry)) return { kind: 'carried', carry }
	if (result_of(context, carry).result === 'completed') return hand_back(context, read.carry)

	return read
}

function finished_session(context: WakeContext): string | undefined {
	const read = read_carry(context)
	if (read.kind !== 'carried' || read.carry.is_handed_off !== true) return undefined

	return read.carry.owner_session
}

function refresh(context: WakeContext): void {
	const session = finished_session(context)
	if (session === undefined) return
	const wake = run_wake.read_wake(context.wake_target)
	if (wake === undefined || wake.spawned?.at(-1) !== session) return

	run_wake.update_wake(context.wake_target, run_wake.count_claim(wake))
}

function failure_note(result: AgentEventState): string | undefined {
	return result.result === 'completed'
		? undefined
		: `Codex judgment ended without a successful result: ${result.reason ?? result.result}`
}

function failure(context: WakeContext): string | undefined {
	const owned = judgment(context)
	if (owned === undefined) return undefined
	const carry = execution(context, owned)
	if (carry.owner_pid === undefined || is_running(carry)) return undefined

	return failure_note(result_of(context, carry))
}

const run_wake_codex = { failure, log_path, read_carry, refresh }

export { run_wake_codex }
