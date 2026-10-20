import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { MachineSample } from '#scripts/gate/machine-capacity'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { vi } from 'vitest'
import type { ClosedAnswer } from './run-board-closed'
import {
	run_board_gather,
	type Gatherer,
	type GatherPorts,
	type GatherRead,
	type GatherState,
} from './run-board-gather'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { BoardPorts } from './run-board-state'

// What the `run:board` redraw suites share: the ports a test drives the board
// through — a clock it moves by hand, the frames it wrote, and counted reads.

const { WORDS } = run_board_labels
const START = Date.parse('2026-10-08T09:00:00.000Z')
const ALL: NamedPlan = { issues: [], only: false }
const LOCAL: LocalRead = {
	started_ms: START,
	ended_ms: undefined,
	scope: ALL,
	events: [],
	lanes: [],
	resume: undefined,
	is_stranded: false,
}
const STOPPED = new Error('stopped')
// A machine with nothing swapped and half its memory free.
const SAMPLE: MachineSample = {
	cpu: { busy: 0, total: 0 },
	memory: { available_mb: 512, swapped_mb: 0, pressure_level: undefined },
	total_mb: 1024,
}

// The counted reads a test answers and inspects.
interface Reads {
	read_plan: ReturnType<typeof vi.fn<(scope: NamedPlan) => Promise<BoardPlan | undefined>>>
	// No process snapshot is read unless a test answers otherwise.
	read_table: ReturnType<typeof vi.fn<TableRead>>
	read_local: ReturnType<typeof vi.fn<(table: TableRead) => Promise<LocalRead | undefined>>>
	read_machine: ReturnType<typeof vi.fn<() => Promise<MachineSample>>>
	// No process is read unless a test answers otherwise.
	read_usage: ReturnType<typeof vi.fn<GatherPorts['read_usage']>>
	// Nothing reads closed unless a test answers otherwise.
	read_closed: ReturnType<typeof vi.fn<(issues: ReadonlyArray<number>) => Promise<ClosedAnswer>>>
}

interface Harness extends Reads {
	ports: BoardPorts
	// The ports the board's reads are taken through (`run-board-gather.ts`), read on each redraw, so a
	// test sets a reading wait, a frame read off a terminal or the core budget's claims here.
	gathering: GatherPorts
	frames: Array<string>
	clock: { now_ms: number }
	leaves: Array<() => void>
	// The clock at each report the board recorded.
	marks: Array<number>
	// The frames `--every` sent off-screen.
	pushes: Array<string>
}

function plan_titled(title: string): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: 'joshuafolkken/kit', titles: new Map([[1, title]]), open_numbers: undefined },
		labels: new Map(),
	}
}

// A `sleep` that lets one redraw through, then stops the loop the way an interrupt would.
function stopper(): () => Promise<void> {
	let slept = 0

	return async () => {
		slept += 1
		if (slept > 1) throw STOPPED
	}
}

function reads_of(local: LocalRead | undefined, plans: Array<BoardPlan | undefined>): Reads {
	return {
		read_plan: vi.fn(async (_scope: NamedPlan) => plans.shift()),
		read_table: vi.fn<TableRead>(),
		read_local: vi.fn(async (_table: TableRead) => local),
		read_machine: vi.fn(async () => SAMPLE),
		read_usage: vi.fn<GatherPorts['read_usage']>(),
		read_closed: vi.fn(async (_issues: ReadonlyArray<number>): Promise<ClosedAnswer> => ({
			closed: new Map(),
			is_whole: true,
		})),
	}
}

type Recorded = Pick<Harness, 'frames' | 'clock' | 'leaves' | 'marks' | 'pushes'>

// The ports that only record what the board did with them.
function recording_ports(
	recorded: Recorded,
): Omit<BoardPorts, 'read_plan' | 'read_closed' | 'gather'> {
	const { frames, clock, leaves, marks, pushes } = recorded

	return {
		now: () => clock.now_ms,
		write: (frame) => {
			frames.push(frame)
		},
		link: (text) => text,
		is_tty: true,
		form: 'screen',
		mark: async () => {
			marks.push(clock.now_ms)
		},
		push: async (frame) => {
			pushes.push(frame)
		},
		on_exit: (leave) => {
			leaves.push(leave)
		},
		sleep: stopper(),
	}
}

interface Carry {
	state: GatherState
}

// A function of its own so the write does not sit after an `await`, where `require-atomic-updates`
// reads it as a possible race; the redraws a test drives never overlap.
function keep(carry: Carry, state: GatherState): GatherRead {
	carry.state = state

	return run_board_gather.read_of(state)
}

// The reads a live board's worker takes, folded here on each redraw so a test drives them by hand.
function carried(ports: GatherPorts): Gatherer {
	const carry: Carry = { state: run_board_gather.FRESH_GATHER }

	return async (pace) => keep(carry, await run_board_gather.gather(carry.state, ports, pace))
}

function gather_ports(
	reads: Reads,
	board: Omit<BoardPorts, 'read_plan' | 'read_closed' | 'gather'>,
): GatherPorts {
	const { read_table, read_local, read_machine, read_usage } = reads

	return {
		read_table,
		read_local,
		read_machine,
		read_usage,
		is_live: true,
		now: board.now,
		sleep: board.sleep,
	}
}

function harness(local: LocalRead | undefined, plans: Array<BoardPlan | undefined>): Harness {
	const recorded: Recorded = {
		frames: [],
		clock: { now_ms: START },
		leaves: [],
		marks: [],
		pushes: [],
	}
	const reads = reads_of(local, plans)
	const board = recording_ports(recorded)
	const { read_plan, read_closed } = reads
	const gathering = gather_ports(reads, board)
	const ports = { read_plan, read_closed, gather: carried(gathering), ...board }

	return { ...reads, ...recorded, gathering, ports }
}

// The plan read's loading spinner after its ⏳, not the waiting count the same line draws after its own
// ⏳.
const SPINNING = /⏳ [^\d-]/u

const run_board_fixture = { LOCAL, SPINNING, START, STOPPED, WORDS, harness, plan_titled }

export { run_board_fixture }
export type { Harness }
