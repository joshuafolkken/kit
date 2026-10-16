import { core_wait, type BudgetWait } from '#scripts/gate/core-wait'

// The claims waiting in the machine-wide core budget, under the header (joshuafolkken/kit#3943): a lane
// held back by memory pressure otherwise reads the same as one that is stuck. Each line names the
// command, the lane it runs in — the main checkout where none, and another repository's checkout by
// name, unlinked — how long it has waited, and why.

const MS_PER_SECOND = 1000
// 🚧 rather than ⏳, which a waiting row already draws, or 🚦, the gate stage's; an emoji a terminal
// draws two columns wide.
const BUDGET_ICON = '🚧'
const GAP = '  '
const MAIN_CHECKOUT = 'main'

function place_text(wait: BudgetWait, link: (reference: string) => string): string {
	if (wait.elsewhere !== undefined) return wait.elsewhere

	return wait.lane === undefined ? MAIN_CHECKOUT : link(wait.lane)
}

function wait_text(wait: BudgetWait, link: (reference: string) => string): string {
	const lane = place_text(wait, link)
	const seconds = `${String(Math.round(wait.waited_ms / MS_PER_SECOND))}s`
	const parts = [wait.command ?? 'a step', lane, seconds, core_wait.REASON_TEXT[wait.reason]]

	return `${BUDGET_ICON} ${parts.join(GAP)}`
}

// Nothing is drawn while no claim waits.
function wait_lines(
	waits: ReadonlyArray<BudgetWait> | undefined,
	link: (reference: string) => string,
): Array<string> {
	if (waits === undefined || waits.length === 0) return []

	return ['', ...waits.map((wait) => wait_text(wait, link))]
}

const run_board_render_waits = { BUDGET_ICON, wait_lines }

export { run_board_render_waits }
