import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import type { BoardPorts, LocalRead } from './run-board-tick'

// What the `run:board` redraw suites share (joshuafolkken/kit#3444): the ports a test drives the board
// through — a clock it moves by hand, the frames it wrote, and counted reads.

const WORDS = run_board_labels.words_of('en')
const START = Date.parse('2026-10-08T09:00:00.000Z')
const ALL: NamedPlan = { issues: [], only: false }
const LOCAL: LocalRead = { started_ms: START, scope: ALL, events: [], lanes: [] }
const STOPPED = new Error('stopped')

interface Harness {
	ports: BoardPorts
	frames: Array<string>
	read_plan: ReturnType<typeof vi.fn<(scope: NamedPlan) => Promise<BoardPlan | undefined>>>
	read_local: ReturnType<typeof vi.fn<() => Promise<LocalRead | undefined>>>
	clock: { now_ms: number }
	leaves: Array<() => void>
}

function plan_titled(title: string): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: 'joshuafolkken/kit', titles: new Map([[1, title]]), open_numbers: undefined },
	}
}

// `sleep` lets one redraw through, then stops the loop the way an interrupt would.
function harness(local: LocalRead | undefined, plans: Array<BoardPlan | undefined>): Harness {
	const frames: Array<string> = []
	const leaves: Array<() => void> = []
	const clock = { now_ms: START }
	const read_plan = vi.fn(async (_scope: NamedPlan) => plans.shift())
	const read_local = vi.fn(async () => local)
	let slept = 0
	const ports: BoardPorts = {
		read_plan,
		read_local,
		now: () => clock.now_ms,
		write: (frame) => {
			frames.push(frame)
		},
		is_tty: true,
		on_exit: (leave) => {
			leaves.push(leave)
		},
		sleep: async () => {
			slept += 1
			if (slept > 1) throw STOPPED
		},
	}

	return { ports, frames, read_plan, read_local, clock, leaves }
}

const run_board_fixture = { LOCAL, START, STOPPED, WORDS, harness, plan_titled }

export { run_board_fixture }
export type { Harness }
