import type { RowYield, YieldStage } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import type { ItemState } from './run-board-status'

// When an issue row gives way to a short pane (`run-board-fit.ts`): the stage its state yields in,
// and how old it is within that stage.

// The stage each state's row gives way in when the pane is short. A row waiting on a person's decision
// stays as long as a running one (joshuafolkken/kit#4099).
const YIELD_STAGES: Readonly<Record<ItemState, YieldStage>> = {
	merged: 'finished',
	done: 'finished',
	withdrawn: 'finished',
	waiting: 'pending',
	human: 'decision',
	parked: 'parked',
	stopped: 'parked',
	earlier: 'parked',
	running: 'running',
	paused: 'running',
}

// A running row is as old as its start; a settled one as its end, or its start where it has none.
function aged_ms(row: BoardRow): number | undefined {
	const started = row.status?.started_ms

	return row.state === 'running' ? started : (row.status?.ended_ms ?? started)
}

// The stage is the state's, unless the row's section gives it way as one — the 🔗 waiting rows before
// the findings.
function yield_of(row: BoardRow, stage: YieldStage = YIELD_STAGES[row.state]): RowYield {
	return { stage, at_ms: aged_ms(row) }
}

const run_board_row_yield = { yield_of }

export { run_board_row_yield }
