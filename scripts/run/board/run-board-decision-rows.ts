import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_human_merge } from './run-board-human-merge'
import { run_board_kind } from './run-board-kind'
import type { BoardPlan, BoardRow, DecisionBlocker, RowReason } from './run-board-layout-types'
import { run_board_review_stop } from './run-board-review-stop'

// joshuafolkken/kit#8026: the 🙋 decision section draws the issue a person acts on, one row per
// blocker, with what the person does and the run's children it holds. A blocker the board already
// draws as a person's row gains the children it holds; one outside the run's scope gets a row of its
// own. The children it holds stay waiting rows, drawn as any other blocked row.

function need_reason(blocker: DecisionBlocker, plan: BoardPlan): RowReason {
	if (blocker.need === 'review') return run_board_review_stop.reason_of(blocker.number, plan)
	if (blocker.need === 'publish') return { tail: '→ publish' }
	if (blocker.need === 'take') return { tail: '→ take into a run' }
	const detail = blocker.detail === undefined ? '' : ` (${blocker.detail})`

	return { tail: `→ decide${detail}` }
}

// An open pull request is what a person merges, whatever else the blocker waits on; a merge wait keeps
// its 🔏 and says to find the pull request when the listing pairs none.
function action_of(blocker: DecisionBlocker, plan: BoardPlan): RowReason {
	const prs = plan.human_merge_prs
	if (blocker.need === 'merge') return run_board_human_merge.pr_reason(blocker.number, prs)
	const pr = prs?.get(blocker.number)

	return pr === undefined ? need_reason(blocker, plan) : run_board_human_merge.merge_reason(pr)
}

function blocks_note(blocks: ReadonlyArray<number>): string {
	const cited = blocks.map((number) => issue_cite.plain_for('terminal', number))

	return `(blocks ${cited.join(', ')})`
}

function with_blocks(row: BoardRow, blocks: ReadonlyArray<number> | undefined): BoardRow {
	if (blocks === undefined) return row
	const parts = [row.reason?.tail, blocks_note(blocks)]
	const tail = parts.filter((part) => part !== undefined).join(' ')

	return { ...row, reason: { ...row.reason, tail } }
}

// The person's rows, each a blocker naming the children it holds.
function held(rows: ReadonlyArray<BoardRow>, plan: BoardPlan): Array<BoardRow> {
	const blocks = new Map((plan.decision_blockers ?? []).map((item) => [item.number, item.blocks]))

	return rows.map((row) => (row.state === 'human' ? with_blocks(row, blocks.get(row.number)) : row))
}

function blocker_row(blocker: DecisionBlocker, plan: BoardPlan): BoardRow {
	const row: BoardRow = {
		number: blocker.number,
		title: blocker.title,
		kind: run_board_kind.kind_of(blocker.labels),
		priority: run_board_kind.priority_of(blocker.labels),
		state: 'human',
		status: undefined,
		waits: [],
		reason: action_of(blocker, plan),
	}

	return with_blocks(row, blocker.blocks)
}

// The blockers no row of the run draws (`drawn`), each a 🙋 row of its own.
function rows_of(plan: BoardPlan, drawn: ReadonlySet<number>): Array<BoardRow> {
	const outside = (plan.decision_blockers ?? []).filter((blocker) => !drawn.has(blocker.number))

	return outside.map((blocker) => blocker_row(blocker, plan))
}

const run_board_decision_rows = { held, rows_of }

export { run_board_decision_rows }
