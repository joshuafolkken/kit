import { userInfo } from 'node:os'
import { lane_reap } from './lane-reap'
import { lane_residents, type ResidentLane } from './lane-residents'

// What a close does about the lane's processes once the SIGTERM went out (joshuafolkken/kit#4300).
//
// **A SIGTERM is a request, so the close looks again.** After a grace window the lane's directory is
// read again; whatever is still there gets a SIGKILL, and after a short wait the directory is read a
// last time. What survives that is reported, each with why it could — another account owns it, or it
// is stuck in the kernel — so `lane:close` answers `incomplete` and `run:board` can say what is wrong
// rather than only that something is left.

// Long enough for a node process to run its exit handlers.
const GRACE_MS = 3000
// A SIGKILL is not handled, so what still answers after this is not going to go.
const KILL_WAIT_MS = 1000
const KILL_SIGNAL = 'SIGKILL'
const STATE_FORMAT = ['-o', 'user=,stat=', '-p']
const FIELD_SEPARATOR = /\s+/u
const UNREADABLE_TEXT = "the lane's processes (lsof or ps failed)"

interface SettleProbes {
	// `undefined` where the lane's processes could not be read (`lane_residents.residents`).
	residents: (lane: ResidentLane) => Array<number> | undefined
	kill: (pid: number) => boolean
	wait: (milliseconds: number) => Promise<void>
	// Why a process outlived the SIGKILL.
	reason_of: (pid: number) => string
}

interface Survivor {
	pid: number
	reason: string
}

function kill(pid: number): boolean {
	try {
		process.kill(pid, KILL_SIGNAL)

		return true
	} catch {
		return false
	}
}

async function wait(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

// Another account's process is the usual survivor — a SIGKILL from this one is refused; otherwise
// `ps`'s state says it, `U` for an uninterruptible wait.
function reason_from(user: string, state: string): string {
	if (user !== userInfo().username) return `owned by ${user}`

	return `state ${state}`
}

function reason_of(pid: number): string {
	const printed = lane_reap.run_probe(lane_reap.PS_COMMAND, [...STATE_FORMAT, String(pid)])
	const [user = '', state = ''] = printed.trim().split(FIELD_SEPARATOR)

	return user.length === 0 ? 'unreadable' : reason_from(user, state)
}

const SYSTEM_PROBES: SettleProbes = {
	residents: (lane) => lane_residents.residents(lane),
	kill,
	wait,
	reason_of,
}

// A reading that failed is not an empty one.
function is_empty(reading: ReadonlyArray<number> | undefined): boolean {
	return reading?.length === 0
}

async function kill_all(
	lingering: ReadonlyArray<number> | undefined,
	probes: SettleProbes,
): Promise<void> {
	const targets = lingering ?? []

	for (const pid of targets) probes.kill(pid)

	await probes.wait(KILL_WAIT_MS)
}

function survivors(lane: ResidentLane, probes: SettleProbes): Array<Survivor> | undefined {
	return probes.residents(lane)?.map((pid) => ({ pid, reason: probes.reason_of(pid) }))
}

/**
 * Wait out the SIGTERM a reap sent, SIGKILL what is still in the lane's directory, and answer what
 * outlived even that — the empty list is a lane with no process left, `undefined` a last reading that
 * failed. A failed reading is never read as none: it is read again, and nothing is killed on it.
 */
async function settle(
	lane: ResidentLane,
	probes: SettleProbes = SYSTEM_PROBES,
): Promise<Array<Survivor> | undefined> {
	if (is_empty(probes.residents(lane))) return []

	await probes.wait(GRACE_MS)

	const lingering = probes.residents(lane)

	if (is_empty(lingering)) return []

	await kill_all(lingering, probes)

	return survivors(lane, probes)
}

/** How a close's `left_behind` names what `settle` answered; a failed reading is named as such. */
function survivor_texts(settled: ReadonlyArray<Survivor> | undefined): Array<string> {
	if (settled === undefined) return [UNREADABLE_TEXT]

	return settled.map((survivor) => `process ${String(survivor.pid)} (${survivor.reason})`)
}

const lane_reap_settle = { GRACE_MS, KILL_WAIT_MS, reason_from, settle, survivor_texts }

export type { SettleProbes, Survivor }
export { lane_reap_settle }
