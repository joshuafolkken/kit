import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { poll } from '#scripts/lib/poll'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_wake, type RunWake } from './run-wake'
import type { WakeContext } from './run-wake-describe'

// How a supervisor claims the run it watches — including the one `josh backlogrun` starts beside the
// parent it launched, before that parent has claimed the carry record (joshuafolkken/kit#3804).
//
// **That supervisor is started by the command, not by the parent's own shell.** Claude Code removes its
// token from every process its Bash tool starts, so a supervisor the parent started there could not
// authenticate the sessions it wakes wherever the token is the only credential. Started by the command,
// it inherits the token — but before the parent has run `run:carry --begin`, so it waits for that record
// while the launch that will write it is alive, and gives up once that launch is gone.
//
// **While a launch is pending, only a live owner's record is its parent's**: a dead owner's record is one
// an earlier run left, and supervising it would wake that run beside the parent just launched.

interface AwaitPorts {
	read_carry: () => CarryRead
	// The invocation of the launched parent that has not claimed the carry record yet, `undefined` once
	// no such launch is alive.
	pending_invocation: () => string | undefined
	is_owner_live: (carry: RunCarry) => boolean
	sleep: (milliseconds: number) => Promise<void>
}

type ClaimResult =
	| { kind: 'claimed'; wake: RunWake; carry: RunCarry }
	| { kind: 'running' }
	| { kind: 'refused'; carry_kind: CarryRead['kind'] }

function is_live_carry(read: CarryRead, ports: AwaitPorts): boolean {
	return read.kind === 'carried' && ports.is_owner_live(read.carry)
}

// What the supervisor claims its record for: the live carried run, else the launch about to carry one,
// else the carried run a supervisor started with no launch pending wakes.
function supervised_invocation(ports: AwaitPorts): string | undefined {
	const read = ports.read_carry()

	if (read.kind !== 'carried') return ports.pending_invocation()
	if (ports.is_owner_live(read.carry)) return read.carry.invocation

	return ports.pending_invocation() ?? read.carry.invocation
}

// **The carry record is read once more after the launch is gone**, because a parent that wrote the
// record and ended between the two reads still left a run to supervise.
async function await_carry(ports: AwaitPorts, interval_ms: number): Promise<CarryRead> {
	const read = ports.read_carry()

	if (is_live_carry(read, ports)) return read
	if (ports.pending_invocation() === undefined) return ports.read_carry()

	await ports.sleep(interval_ms)

	return await await_carry(ports, interval_ms)
}

function ports_of(context: WakeContext): AwaitPorts {
	return {
		read_carry: () => run_carry.read_carry(context.carry_target),
		pending_invocation: () => backlogrun_launch.pending_launch(context.git_directory)?.invocation,
		is_owner_live: (carry) => run_carry.is_owner_live(carry),
		sleep: poll.sleep,
	}
}

// The run the claim is held for: the one claimed for, or **a live run carried under another
// invocation** — a person's own `run:carry --begin` landing before the launched parent's. That run's
// `run:wake --start` found this supervisor live and answered `running`, so letting the claim go here
// would leave it with nobody watching it.
function supervised_carry(
	read: CarryRead,
	invocation: string,
	ports: AwaitPorts,
): RunCarry | undefined {
	if (read.kind !== 'carried') return undefined
	if (read.carry.invocation === invocation || ports.is_owner_live(read.carry)) return read.carry

	return undefined
}

// **The record is re-pointed at the run it now supervises**, because the loop wakes sessions for the
// record's invocation. A refused write means the record is no longer this process's, which the loop's
// first pass reads as the stop it is.
function held_for(target: string, wake: RunWake, carry: RunCarry): ClaimResult {
	if (carry.invocation === wake.invocation) return { kind: 'claimed', wake, carry }

	const supervised = { ...wake, invocation: carry.invocation }

	run_wake.update_wake(target, supervised)

	return { kind: 'claimed', wake: supervised, carry }
}

// **The record is claimed before the carry record is awaited**, so the parent's own `run:wake --start`
// finds this supervisor live and answers `running` rather than starting a second one beside it.
// A parent that ends without carrying a run leaves nothing to supervise, and the claim is let go.
async function claim_run(
	context: WakeContext,
	profile: AgentProfile,
	interval_ms: number,
	ports: AwaitPorts = ports_of(context),
): Promise<ClaimResult> {
	const invocation = supervised_invocation(ports)
	if (invocation === undefined) return { kind: 'refused', carry_kind: ports.read_carry().kind }
	const wake = run_wake.claim(context.wake_target, invocation, new Date(), profile)
	if (wake === undefined) return { kind: 'running' }
	const read = await await_carry(ports, interval_ms)
	const carry = supervised_carry(read, invocation, ports)
	if (carry !== undefined) return held_for(context.wake_target, wake, carry)

	run_wake.tidy_own_wake(context.wake_target)

	return { kind: 'refused', carry_kind: read.kind }
}

const run_wake_await = { await_carry, claim_run, supervised_invocation }

export type { AwaitPorts, ClaimResult }
export { run_wake_await }
