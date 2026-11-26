import { run_board_fit, type PlanLine } from './run-board-fit'
import { run_board_render_title } from './run-board-render-title'
import { run_board_row_key, type KeySection } from './run-board-row-key'

// joshuafolkken/kit#8917: demo mode's sample lanes. A themed board in demo mode with no lane of its own
// draws these three rows under its lanes rule, so the ROW event (`d`) has a lane to type on — the last
// one, as on a real board. They are the confirmed demo frame's rows, keyed as a real lane row is
// (`run-board-render-row.ts` row_line), so the theme's layout finds them; drawn in no theme they read
// as the default board's, and a theme restyles them as any line. The lanes rule's counts stay the
// board's own: the samples are scenery, never figures.

const SECTION: KeySection = 'lanes'

// The sample rows by issue number — as a key reads it — in the order they are drawn.
const SAMPLES: ReadonlyArray<readonly [string, string]> = [
	[
		'8899',
		'     🚢      19″   15′39″      7.3      2.1        0.9 8899    ✨ Carry run:board render cost from the demo into …  🎯 19:37 +2′',
	],
	[
		'8897',
		'     🔨   12′06″   15′39″      4.9      1.9        0.8 8897    ✨ Remove main-thread stalls outside the draw time…  🎯 19:37 +2′  🔧  12″',
	],
	[
		'8826',
		'     🔨    3′31″   14′38″      0.1      0.5        0.3 8826 🔺 ✨ Add a cell back buffer and one frame loop for r…  🎯 19:39 +2′  🔧  26″',
	],
]

// The sample rows' keys, which a frame drawing them counts as known, so they never type as new rows.
const SAMPLE_KEYS: ReadonlyArray<string> = SAMPLES.map(([number]) =>
	run_board_row_key.key_of(SECTION, number),
)

// `text` cut to the pane's columns, so a sample row stays on one screen row; whole without a pane.
function cut_to(text: string, columns: number | undefined): string {
	if (columns === undefined || run_board_fit.width_of(text) <= columns) return text

	return run_board_render_title.columns_cut(text, columns)
}

// A sample row is an issue row as a running lane's is: the plan keeps it (a line with no row — a rule,
// an epic's own line — is dropped at a section's end, `run-board-fit.ts` kept_lines) and gives it way
// last.
const SAMPLE_YIELD = { stage: 'running', at_ms: undefined } as const

// The sample rows as lane plan lines, keyed where the board keys its rows.
function lines_of(is_keyed: boolean, columns: number | undefined): Array<PlanLine> {
	const section = is_keyed ? SECTION : undefined

	return SAMPLES.map(([number, text]) => ({
		text: run_board_row_key.keyed(section, number, cut_to(text, columns)),
		row: SAMPLE_YIELD,
	}))
}

// `keys` with the sample rows' keys among them.
function with_samples(keys: ReadonlySet<string>): ReadonlySet<string> {
	return new Set([...keys, ...SAMPLE_KEYS])
}

// Whether `key` is a sample row's: a theme spins on it as on a running lane, as the demo frame does.
function is_sample(key: string): boolean {
	return SAMPLE_KEYS.includes(key)
}

const run_board_demo_lanes = { is_sample, lines_of, with_samples }

export { run_board_demo_lanes }
