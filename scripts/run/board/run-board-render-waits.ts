import type { BudgetWait, WaitReason } from '#scripts/gate/core-wait'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardRow } from './run-board-layout'

// The claims waiting in the machine-wide core budget (joshuafolkken/kit#3943, #4052): a lane held back
// by memory pressure otherwise reads the same as one that is stuck. A lane's wait is drawn on its own
// row — 🚧 in place of its phase icon, and why, how long and which check in place of its newest
// activity — so a wait coming and going moves no line. A wait no running row owns — the main
// checkout's, another repository's — is one line under the header, which a short pane never cuts.

const { HEADER_ICONS, WORDS, span_of } = run_board_labels
// 🚧 rather than ⏳, which a waiting row already draws, or 🚦, the gate stage's; an emoji a terminal
// draws two columns wide.
const BUDGET_ICON = '🚧'
const INDENT = '  '
const MAIN_CHECKOUT = 'main'
const UNNAMED_CHECK = 'step'
const RELATED_SUFFIX = ':related'
// Why a claim waits, as the header draws the gauge it waits on.
const REASON_ICONS: Readonly<Record<WaitReason, string>> = {
	cores: HEADER_ICONS.cpu,
	memory: HEADER_ICONS.memory,
	pressure: HEADER_ICONS.memory,
}
const REASON_WORDS: ReadonlyArray<readonly [string, string]> = [
	[HEADER_ICONS.memory, WORDS.memory],
	[HEADER_ICONS.cpu, WORDS.cores],
]

// The check's short name: the command's last word without `:related` (`gate lint` → `lint`).
function check_of(wait: BudgetWait): string {
	const word = wait.command?.split(' ').at(-1)

	return word === undefined || word === '' ? UNNAMED_CHECK : word.replace(RELATED_SUFFIX, '')
}

// Why, how long — right-aligned to `width` — and which check.
function held_text(wait: BudgetWait, width: number): string {
	return `${REASON_ICONS[wait.reason]} ${span_of(wait.waited_ms).padStart(width)} ${check_of(wait)}`
}

function is_lane_row(row: BoardRow, wait: BudgetWait): boolean {
	return row.state === 'running' && String(row.number) === wait.lane
}

// The wait a running row's lane is held in, if any.
function held_of(row: BoardRow, header: BoardHeader): BudgetWait | undefined {
	return header.budget_waits?.find((wait) => is_lane_row(row, wait))
}

function place_text(wait: BudgetWait, link: (reference: string) => string): string {
	if (wait.elsewhere !== undefined) return wait.elsewhere

	return wait.lane === undefined ? MAIN_CHECKOUT : link(wait.lane)
}

// The waits no running row draws.
function stray_of(header: BoardHeader): Array<BudgetWait> {
	const rows = header.layout === undefined ? [] : run_board_layout.rows_of(header.layout)

	return (header.budget_waits ?? []).filter((wait) => rows.every((row) => !is_lane_row(row, wait)))
}

// One line for each wait no running row draws, nothing while none waits.
function stray_lines(header: BoardHeader): Array<string> {
	return stray_of(header).map(
		(wait) => `${INDENT}${BUDGET_ICON} ${held_text(wait, 0)} ${place_text(wait, header.link)}`,
	)
}

// 🚧 and the reasons the frame draws, nothing while none waits; every wait is drawn, on its row or
// under the header.
function legend_of(header: BoardHeader): Array<string> {
	const waits = header.budget_waits ?? []

	if (waits.length === 0) return []

	const icons = new Set(waits.map((wait) => REASON_ICONS[wait.reason]))
	const reasons = REASON_WORDS.filter(([icon]) => icons.has(icon))

	return [`${BUDGET_ICON} ${WORDS.held_check}`, ...reasons.map(([icon, word]) => `${icon} ${word}`)]
}

const run_board_render_waits = { BUDGET_ICON, held_of, held_text, legend_of, stray_lines }

export { run_board_render_waits }
