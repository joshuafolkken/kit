import type { RowYield, YieldStage } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import type { ItemState } from './run-board-status'

// When an issue row gives way to a short pane (`run-board-fit.ts`): the stage its state yields in,
// and how old it is within that stage.

// The stage each state's row gives way in when the pane is short.
const YIELD_STAGES: Readonly<Record<ItemState, YieldStage>> = {
	merged: 'finished',
	done: 'finished',
	withdrawn: 'finished',
	waiting: 'pending',
	human: 'pending',
	parked: 'parked',
	stopped: 'parked',
	running: 'running',
}

// A running row is as old as its start; a settled one as its end, or its start where it has none.
function aged_ms(row: BoardRow): number | undefined {
	const started = row.status?.started_ms

	return row.state === 'running' ? started : (row.status?.ended_ms ?? started)
}

function yield_of(row: BoardRow): RowYield {
	return { stage: YIELD_STAGES[row.state], at_ms: aged_ms(row) }
}

const run_board_row_yield = { yield_of }

export { run_board_row_yield }
