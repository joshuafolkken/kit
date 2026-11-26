import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Channel, Grid, ThemeApi, ThemeColors, ThemeState } from './run-board-theme-host-types'

// The progress line settles back, in every theme (joshuafolkken/kit#8917, kit only — the demo keeps it
// in the typing color): the host lays it in the 'type' role (`run-board-theme-host-frame.ts` lay_text);
// once its last letter lands, each cell blends over three seconds to the color the board gives it, the
// body text and its marks' own colors. The notice keeps its role color.

const { BOLD, DIM, cell_at, fg, mixed, set_cell } = run_board_theme_host_grid

const SETTLE_TICKS = 60
// The progress line's icon sits three columns before its text, laid in the same role.
const ICON_LEAD = 3
const KEY_PARTS = 2
const TRUE_COLOR = /38;2;(\d+;\d+;\d+)/u
const ROLE = 'type'

interface Settle {
	grid: Grid
	api: ThemeApi
	state: ThemeState
}

// The ticks since `channel`'s last letter landed; undefined while it types or before it starts.
function since_of(channel: Channel): number | undefined {
	if (channel.index < 0 || channel.is_typing) return undefined

	return channel.cooled
}

const INKS: Readonly<Partial<Record<string, string>>> = { dim: DIM, bold: BOLD }

// A base cell's color 'r;g;b' and its attribute: a role key through the theme's colors, an SGR as is.
function role_look(key: string, colors: ThemeColors): { rgb: string; ink: string } {
	const [role, attribute] = key.split(':', KEY_PARTS)
	const named: Readonly<Partial<Record<string, string>>> = colors

	return { rgb: named[String(role)] ?? colors.body, ink: INKS[String(attribute)] ?? '' }
}

function look_of(style: string, colors: ThemeColors): { rgb: string; ink: string } {
	const sgr = TRUE_COLOR.exec(style)

	if (sgr) return { rgb: String(sgr[1]), ink: '' }

	return role_look(style, colors)
}

// A cell's style `since` ticks into the settle: the typing color blended toward the base cell's, the
// base's own style once there.
function blended(colors: ThemeColors, since: number, base: string): string {
	const share = Math.min(1, since / SETTLE_TICKS)
	const look = look_of(base, colors)

	if (share >= 1) return base

	return `${fg(mixed(colors[ROLE], look.rgb, share))}${look.ink}`
}

// Only the cells still in the typing role: a theme's own drawing over them stays.
function settle_progress(frame: Settle, colors: ThemeColors): void {
	const { api, grid, state } = frame
	const since = since_of(state.progress)

	if (since === undefined) return
	const { y, x, end } = state.progress.span

	for (let at = Math.max(0, x - ICON_LEAD); at < end; at++) {
		const [ch, style] = cell_at(grid, y, at)
		const [, base] = cell_at(api.board, y, at)

		if (style === ROLE) set_cell(grid, { y, x: at }, [ch, blended(colors, since, base)])
	}
}

const run_board_theme_host_settle = { SETTLE_TICKS, look_of, settle_progress, since_of }

export { run_board_theme_host_settle }
