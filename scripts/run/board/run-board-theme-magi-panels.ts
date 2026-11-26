import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Grid, ThemeState } from './run-board-theme-host-types'
import {
	run_board_theme_magi_data,
	type MagiKit,
	type MagiPanel,
	type PanelLook,
} from './run-board-theme-magi-data'
import { run_board_theme_magi_draw } from './run-board-theme-magi-draw'

// The MAGI theme's three panels (joshuafolkken/kit#8917), ported from the confirmed theme demo: what
// each shows — deliberating, a verdict, ALERT, monitoring, its idle self-check — and the links.

const { BOLD, centered, fg, put, repeated } = run_board_theme_host_grid
const { active, NOTICE_END } = run_board_theme_host_state
const { trace_on } = run_board_theme_host_flash
const { AMBER, AMBER_BOLD, BLINK, EFFECT_TAIL, GREEN, ORANGE, ORANGE_ON, RED_ON } =
	run_board_theme_magi_data
const { VERDICTS, VOTE_END } = run_board_theme_magi_data
const { is_lit, link_pair } = run_board_theme_magi_draw

// While the line types a panel blinks slowly; once it finishes, quickly, until its verdict comes.
const DELIBERATE = { typing: { every: 9, on: 4 }, voting: { every: 4, on: 2 }, offset: 3, step: 8 }
// Idle: the pulse's ticks a panel, and the self-check's offset, cycle, bar, ALL GREEN and width.
const IDLE = { pulse: 12, offset: 33, cycle: 100, bar: 24, cell: 4, green: 34, width: 12 }
const PANEL_COUNT = 3
const RED = '255;60;40'
const LIGHT = '230;120;0'
const DARK = '140;70;0'
const ALL_GREEN: PanelLook = { text: 'ALL GREEN', frame: '90;200;120', fill: GREEN }
const APPROVE: PanelLook = { text: 'APPROVE', frame: AMBER, fill: ORANGE_ON }
const REJECT: PanelLook = { text: 'REJECT', frame: RED, fill: RED_ON }
// The links run in from either side, short of MAGI; idle, the pulse moves a cell every third tick.
const LINK = { inset: 4, idle_pace: 3, wrap: 6, label: 3 }
const HALF = 2

function is_voting(progress: Channel): boolean {
	return progress.index >= 0 && progress.cooled < VOTE_END
}

// The verdict of panel `panel` on the progress line `line`: 1 approves.
function verdict_of(line: number, panel: number): number {
	return VERDICTS[line % VERDICTS.length]?.[panel] ?? 0
}

function deliberating_look(is_typing: boolean, tick: number, index: number): PanelLook {
	const beat = is_typing ? DELIBERATE.typing : DELIBERATE.voting
	const is_on = is_lit(tick + index * DELIBERATE.offset, beat)

	return { text: 'DELIBERATING', frame: is_on ? AMBER : DARK, fill: is_on ? ORANGE_ON : ORANGE }
}

function is_deliberating(progress: Channel, is_vote: boolean, index: number): boolean {
	return progress.is_typing || (is_vote && progress.cooled < DELIBERATE.step * (index + 1))
}

// A panel deliberates while the progress line types, then gives its verdict, one panel at a time.
function progress_look(state: ThemeState, tick: number, index: number): PanelLook | undefined {
	const { progress } = state
	const is_vote = is_voting(progress)

	if (is_deliberating(progress, is_vote, index)) {
		return deliberating_look(progress.is_typing, tick, index)
	}

	if (is_vote) return verdict_of(progress.index, index) === 1 ? APPROVE : REJECT

	return undefined
}

// While the notice builds the panels flicker; after the peak they light with the trace's bars.
function alert_look(state: ThemeState, tick: number): PanelLook {
	const is_on = state.notice.is_typing ? is_lit(tick, BLINK.fast) : trace_on(state)

	return { text: 'ALERT', frame: is_on ? RED : '120;20;10', fill: is_on ? RED_ON : fg(RED) }
}

// A lane syncing: the three watch it, lit in turn, quickly.
function monitoring_look(tick: number, index: number): PanelLook {
	const is_watching = Math.floor(tick / HALF) % PANEL_COUNT === index

	return {
		text: 'MONITORING',
		frame: is_watching ? '255;230;150' : '200;100;0',
		fill: `${fg(AMBER)}${BOLD}`,
	}
}

// Idle: a pulse passes round the three panels in turn, and every five seconds each panel, in its
// own turn, runs a self-check — a bar filling, then ALL GREEN for a moment.
function idle_look(tick: number, index: number): PanelLook {
	const is_pulse = Math.floor(tick / IDLE.pulse) % PANEL_COUNT === index
	const check = (tick + index * IDLE.offset) % IDLE.cycle
	const bar = repeated('▮', Math.floor(check / IDLE.cell))

	if (check < IDLE.bar) {
		return { text: `CHECK ${bar}`.padEnd(IDLE.width), frame: LIGHT, fill: fg(AMBER) }
	}

	if (check < IDLE.green) return ALL_GREEN

	return {
		text: 'STANDBY',
		frame: is_pulse ? LIGHT : '110;55;0',
		fill: fg(is_pulse ? LIGHT : DARK),
	}
}

function panel_look(state: ThemeState, tick: number, index: number): PanelLook {
	const by_progress = progress_look(state, tick, index)

	if (by_progress) return by_progress
	if (active(state.notice, NOTICE_END)) return alert_look(state, tick)
	if (active(state.row, EFFECT_TAIL)) return monitoring_look(tick, index)

	return idle_look(tick, index)
}

// The links between the three: along the USAGE rule's row a dotted line runs in to MAGI from either
// side, and a pulse travels each line toward the middle — slowly when idle, quickly while busy.
function magi_links(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	const { px, pw, edge } = kit.api.layout
	const middle = px + Math.floor(pw / HALF)
	const span = middle - LINK.inset - px
	const at = Math.floor(tick / (state.busy ? 1 : LINK.idle_pace)) % (span + LINK.wrap)

	for (let step = 0; step < span; step++) {
		const xs = { left: px + 1 + step, right: edge - HALF - step }

		link_pair(grid, kit.rows.links, xs, step === at || step === at - 1)
	}
}

// One panel as the board draws it: its frame's top, its sides round the status, its bottom.
function panel_box(grid: Grid, panel: MagiPanel, look: PanelLook): void {
	const { name, x, y, w } = panel
	const frame = `${fg(look.frame)}${BOLD}`

	const inner = Math.max(0, w - HALF)

	put(grid, { y, x }, `┌${name}${'─'.repeat(Math.max(0, inner - name.length))}┐`, frame)
	put(grid, { y: y + 1, x }, '│', frame)
	put(grid, { y: y + 1, x: x + 1 }, centered(look.text, inner), look.fill)
	put(grid, { y: y + 1, x: x + w - 1 }, '│', frame)
	put(grid, { y: y + HALF, x }, `└${repeated('─', inner)}┘`, frame)
}

function magi_panels(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	for (const [index, panel] of kit.panels.entries()) {
		panel_box(grid, panel, panel_look(state, tick, index))
	}

	magi_links(kit, grid, state, tick)
	const { px, pw } = kit.api.layout

	put(grid, { y: kit.rows.links, x: px + Math.floor(pw / HALF) - LINK.label }, ' MAGI ', AMBER_BOLD)
}

const run_board_theme_magi_panels = {
	idle_look,
	magi_panels,
	panel_look,
	verdict_of,
}

export { run_board_theme_magi_panels }
