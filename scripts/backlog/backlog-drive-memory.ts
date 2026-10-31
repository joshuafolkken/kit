import { machine_capacity, type MachineSample } from '#scripts/gate/machine-capacity'
import {
	run_board_machine,
	type MachineGauges,
	type MachineMark,
} from '#scripts/run/board/run-board-machine'
import type { DrivePorts, DriveState, PassResult } from './backlog-drive'

// Whether the machine has room for one more lane (joshuafolkken/kit#4084). The lane limit counts lanes,
// not memory, so a lane opened while the machine swapped slowed every gate already running.
//
// **The reading is `run:board`'s own** (`run-board-machine.ts`): 🧠 and 💾 are the figures a person
// sees beside the waiting row, and the thresholds are the gauges' red and yellow.
//
// **Stopping is looser than resuming, so a machine near one threshold does not open and stop in turn.**
// A lane stops being opened when the kernel calls the memory critical, 🧠 turns red or 💾 swaps at a
// red rate. It resumes only once the kernel reads under critical and 🧠 and 💾 are both back under
// yellow. The kernel's warning is no hold (joshuafolkken/kit#4199): macOS keeps it long after the
// pressure passed, so a run held on it never resumed.
//
// **The 🧠 resume bar stays at yellow** (joshuafolkken/kit#4529): observed memory holds came with
// swap bursts. 💾 is what holds a lane, so a lower 🧠 bar would admit nothing sooner and only risk swap.
//
// **A figure that could not be read is no limit**, as in the gate's core budget: a machine without
// `sysctl` dispatches as it did before memory was read.

const { MEMORY_RED, MEMORY_YELLOW, SWAP_RED_MB_PER_S, SWAP_YELLOW_MB_PER_S } = run_board_machine
const { PRESSURE_HOLD } = machine_capacity
// Two readings closer than this give no swap rate: a page swapped in a few milliseconds is no rate.
const MIN_RATE_MS = 1000
// The `hold` reason a pass held by memory records, read back by `run:board` and `lane:stats`.
const HOLD_REASON = 'memory'

type MemoryGauges = Pick<MachineGauges, 'memory_percent' | 'swap_mb_per_s' | 'memory_pressure'>

function is_kernel_pressured(gauges: MemoryGauges): boolean {
	return (gauges.memory_pressure ?? 0) >= PRESSURE_HOLD
}

function is_stop(gauges: MemoryGauges): boolean {
	return (
		is_kernel_pressured(gauges) ||
		(gauges.memory_percent ?? 0) >= MEMORY_RED ||
		(gauges.swap_mb_per_s ?? 0) >= SWAP_RED_MB_PER_S
	)
}

function is_resume(gauges: MemoryGauges): boolean {
	return (
		!is_kernel_pressured(gauges) &&
		(gauges.memory_percent ?? 0) < MEMORY_YELLOW &&
		(gauges.swap_mb_per_s ?? 0) < SWAP_YELLOW_MB_PER_S
	)
}

interface GaugePorts {
	read: () => Promise<MachineSample>
	now: () => number
}

const PRODUCTION: GaugePorts = { read: machine_capacity.read_sample, now: Date.now }

// What one gauge carries between calls.
interface GaugeMemo {
	last: MachineMark | undefined
	// The last swap rate measured, kept for a reading too close to the last to measure its own.
	swap_mb_per_s: number | undefined
	is_held: boolean
}

// The reading's gauges, the rate measured from the last reading at least `MIN_RATE_MS` old; the last
// moves on only then, so two close calls keep measuring from the same one. A reading too close to
// measure keeps the last rate measured, so a held machine still swapping does not read 0 and resume.
function is_rate_of(last: MachineMark | undefined, mark: MachineMark): last is MachineMark {
	return last !== undefined && mark.at_ms - last.at_ms >= MIN_RATE_MS
}

function rated(memo: GaugeMemo, mark: MachineMark): MemoryGauges {
	const { last } = memo
	const is_rated = is_rate_of(last, mark)

	if (last === undefined || is_rated) memo.last = mark

	const gauges = run_board_machine.gauges_of(is_rated ? last : undefined, mark)

	if (is_rated) memo.swap_mb_per_s = gauges.swap_mb_per_s

	return { ...gauges, swap_mb_per_s: memo.swap_mb_per_s }
}

// The production `memory_held` port: each call reads the machine once, and the hold is carried
// between calls — a held machine waits for the resume, a free one for the stop.
function gauge(ports: GaugePorts = PRODUCTION): () => Promise<boolean> {
	const memo: GaugeMemo = { last: undefined, swap_mb_per_s: undefined, is_held: false }

	return async function memory_held(): Promise<boolean> {
		const gauges = rated(memo, { sample: await ports.read(), at_ms: ports.now() })

		memo.is_held = memo.is_held ? !is_resume(gauges) : is_stop(gauges)

		return memo.is_held
	}
}

// An offer that answered `run` on a machine with no room: nothing launches, the pass records why, and
// the loop polls the memory until it clears.
async function held(state: DriveState, ports: Pick<DrivePorts, 'hold'>): Promise<PassResult> {
	await ports.hold(HOLD_REASON)

	return { kind: 'continue', state: { ...state, is_memory_held: true } }
}

// Whether a held run's memory cleared since: the pass asks the offer again, not waiting out its interval.
async function is_cleared(
	state: DriveState,
	ports: Pick<DrivePorts, 'memory_held'>,
): Promise<boolean> {
	return state.is_memory_held === true && !(await ports.memory_held())
}

const backlog_drive_memory = { HOLD_REASON, gauge, held, is_cleared }

export { backlog_drive_memory }
export type { MemoryGauges }
