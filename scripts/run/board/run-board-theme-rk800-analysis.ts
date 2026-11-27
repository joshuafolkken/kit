import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_parts, type Stage } from './run-board-theme-rk800-parts'

// The rk800 theme's PROGRESS: the clue analysis. In the panel the reticle closes, the percent
// counts under a label that steps through the sync's phases, and a bright red bar grows over its
// dark track; once the line has typed the bar is blue, the count fades and RECONSTRUCT types beside
// a key box. On the board the text eases to grey-blue while the line types — scan mode — and small
// reticle brackets hop over the data.

const { repeated, restyle } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { active, finished } = run_board_theme_host_state
const { PAIR, clear_pane, data_pane, put_in, share_of, typed_share } = run_board_theme_draw
const { ANALYSIS, PANEL, RGB, SCAN_MODE } = run_board_theme_rk800_data
// The level bars: how far from the panel's right edge they stand, their count and height, the
// eighths of a cell a block glyph steps by, their ripple's pace and floor; and the header's places.
const LEVELS = {
	back: 9,
	bars: 5,
	rows: 3,
	steps: 8,
	glyphs: ' ▁▂▃▄▅▆▇█',
	pace: 2,
	low: 0.3,
	salt: 97,
	text_x: 3,
	chip_w: 5,
}
const { bar_width, bold, duo, ink, mix, on, plate, ring, stage_of } = run_board_theme_rk800_parts
// The readout's label through the analysis, timed on the source's frames in ticks of the line's
// typing: SYNC IN PROGRESS while its underline grows and is held, SYNC DONE as long again, then
// COLLECTING DATA until the line has typed — PROCESSING DATA from then on.
const PHASES = { grow: 4, sync: 11, done: 11 }
// The completion, in ticks since the line typed: the count fades, then the key box shows,
// RECONSTRUCT types a letter a tick and the marker slides in. The key's sign is this theme's choice.
const FINISH = { fade: 4, key: ' △ ', word: 'RECONSTRUCT', word_x: 5, slide: 8, marker_back: 3 }

// The readout's label at a moment: its two words, its color and how much of its underline shows.
interface Phase {
	words: readonly [string, string]
	color: string
	rule: number
}

const SYNC_DONE: Phase = { words: ['SYNC', 'DONE'], color: RGB.white, rule: 1 }
const COLLECTING: Phase = { words: ['COLLECTING', 'DATA'], color: RGB.white, rule: 1 }
const PROCESSING: Phase = { words: ['PROCESSING', 'DATA'], color: RGB.blue, rule: 1 }

// The analysis as it stands: how much of the line has typed, whether it has typed through, and the
// color of what is still being read — red, blue once done.
interface Reading {
	share: number
	is_done: boolean
	accent: string
}

function is_analyzing(state: ThemeState): boolean {
	return active(state.progress, ANALYSIS.tail)
}

function reading_of(progress: Channel): Reading {
	const is_done = !progress.is_typing

	return { share: typed_share(progress), is_done, accent: is_done ? RGB.blue : RGB.red }
}

// The head while the analysis runs, and while its count fades: the plate, the hold hint, the ring —
// yellow and quick while the line types, blue once it has.
function running_head(stage: Stage, is_done: boolean, tick: number): void {
	const { pane, right } = stage

	plate(pane, { x: 1, y: 0 }, 'ANALYZE', RGB.steel)
	put_in(pane, { x: right - ANALYSIS.hold_back, y: 0 }, ANALYSIS.hold, ink(RGB.soft))
	ring(pane, { x: right - 1, y: 0 }, is_done ? tick : tick * PAIR, is_done ? RGB.blue : RGB.yellow)
}

// The head once the count has faded, `since` ticks on: a small key box, RECONSTRUCT typed a letter
// a tick, then a small blue marker sliding in from the right to the word's end.
function finished_head(stage: Stage, since: number, tick: number): void {
	const { pane, right } = stage
	const typed = FINISH.word.slice(0, Math.max(0, since))
	const from = right - FINISH.marker_back
	const slid = share_of(since, FINISH.word.length, FINISH.slide)
	const to = FINISH.word_x + FINISH.word.length + 1

	put_in(pane, { x: 1, y: 0 }, FINISH.key, on(RGB.white, RGB.blue))
	put_in(pane, { x: FINISH.word_x, y: 0 }, typed, bold(RGB.white))

	if (slid > 0) {
		put_in(pane, { x: Math.round(from - slid * (from - to)), y: 0 }, '▌', bold(RGB.blue))
	}

	ring(pane, { x: right - 1, y: 0 }, tick, RGB.blue)
}

function head(stage: Stage, progress: Channel, tick: number): void {
	const since = progress.is_typing ? -1 : progress.cooled - FINISH.fade

	if (since < 0) running_head(stage, !progress.is_typing, tick)
	else finished_head(stage, since, tick)
}

// The analysis header under the plate, where the panel has the row: a blue chip, the progress
// line's first word bold and the rest of it thin.
function subject(stage: Stage, progress: Channel): void {
	const { pane, right, body } = stage
	const [first = '', ...rest] = progress.text.trim().split(' ')
	const thin = rest.join(' ').slice(0, Math.max(0, right - first.length - LEVELS.chip_w))

	if (first === '' || body !== PANEL.body) return
	put_in(pane, { x: 1, y: 1 }, '▌', bold(RGB.blue))
	duo(pane, { x: LEVELS.text_x, y: 1 }, [first, thin], RGB.white)
}

// How high bar `index` stands, in eighths of a cell: rippling while the line types, settled after.
function level_of(index: number, reading: Reading, tick: number): number {
	const top = LEVELS.rows * LEVELS.steps
	const settled = (index + PAIR) / (LEVELS.bars + PAIR)
	const ripple = hash(Math.floor(tick / LEVELS.pace), index, LEVELS.salt)

	return Math.round(top * (reading.is_done ? settled : ripple * (LEVELS.low + reading.share)))
}

// One level bar, three rows tall, in block eighths.
function level_bar(stage: Stage, index: number, level: number, style: string): void {
	const x = stage.right - LEVELS.back + index

	for (let row = 0; row < LEVELS.rows; row++) {
		const over = level - (LEVELS.rows - 1 - row) * LEVELS.steps
		const glyph = LEVELS.glyphs.charAt(Math.max(0, Math.min(LEVELS.steps, over)))

		put_in(stage.pane, { x, y: stage.body + row }, glyph, style)
	}
}

// The level bars beside the readout, where the panel has all its rows.
function level_bars(stage: Stage, reading: Reading, tick: number): void {
	if (stage.body !== PANEL.body) return
	const style = reading.is_done ? bold(RGB.cyan) : ink(RGB.soft)

	for (let index = 0; index < LEVELS.bars; index++) {
		level_bar(stage, index, level_of(index, reading, tick), style)
	}
}

// The reticle round `center`: four corners closing in as the line types, shaking until it has.
function reticle(pane: Pane, center: Point, share: number, tick: number): void {
	const jitter = share < 1 && tick % ANALYSIS.beat < ANALYSIS.beat_on ? 1 : 0
	const reach = ANALYSIS.open - Math.round(ANALYSIS.close * share) + jitter
	const [left, right] = [center.x - reach, center.x + reach]
	const [top, low] = [center.y - 1, center.y + 1]

	put_in(pane, { x: left, y: top }, '⌜', bold(RGB.yellow))
	put_in(pane, { x: right, y: top }, '⌝', bold(RGB.blue))
	put_in(pane, { x: left, y: low }, '⌞', bold(RGB.blue))
	put_in(pane, { x: right, y: low }, '⌟', bold(RGB.yellow))
	put_in(pane, center, share < 1 ? '·' : '+', bold(RGB.white))
}

// The label's phase `tick` finds the analysis in.
function phase_of(progress: Channel, tick: number): Phase {
	if (!progress.is_typing) return PROCESSING
	const age = tick - progress.start

	if (age >= PHASES.sync + PHASES.done) return COLLECTING
	if (age >= PHASES.sync) return SYNC_DONE

	return { words: ['SYNC', 'IN PROGRESS'], color: RGB.red, rule: share_of(age + 1, 0, PHASES.grow) }
}

// The readout beside the reticle: the percent, counting with every letter typed, the label in two
// weights and its underline in the label's color.
function readout(stage: Stage, reading: Reading, phase: Phase): void {
	const { pane, body } = stage
	const percent = String(Math.round(reading.share * ANALYSIS.percent)).padStart(ANALYSIS.percent_w)
	const x = ANALYSIS.readout_x
	const rule = repeated('─', Math.round(phase.rule * ANALYSIS.rule_w))

	put_in(pane, { x, y: body }, `${percent}%`, bold(RGB.white))
	duo(pane, { x, y: body + 1 }, phase.words, phase.color)
	put_in(pane, { x, y: body + PAIR }, rule, ink(phase.color))
}

// The clues read of those the board has written, over the bar; it fades once the line has typed.
function tally(stage: Stage, reading: Reading, progress: Channel): void {
	const { pane, bottom } = stage
	const count = `${String(finished(progress))}/${String(progress.index + 1)}`
	const faded = reading.is_done ? share_of(progress.cooled, 0, FINISH.fade) : 0
	const soft = ink(mix(RGB.soft, RGB.night, faded))

	if (faded >= 1) return
	const y = bottom - 1

	put_in(pane, { x: 1, y }, '▪', soft)
	put_in(pane, { x: ANALYSIS.tally_x, y }, count, bold(mix(reading.accent, RGB.night, faded)))
	put_in(pane, { x: ANALYSIS.tally_gap + count.length, y }, ANALYSIS.tally, soft)
}

// The bar on the panel's last row: bright over its dark track, blue once the line has typed.
function bar(stage: Stage, reading: Reading): void {
	const { pane, bottom } = stage
	const width = bar_width(pane.box.w)
	const lit = Math.round(reading.share * width)

	put_in(pane, { x: 1, y: bottom }, repeated('━', lit), bold(reading.accent))
	put_in(pane, { x: 1 + lit, y: bottom }, repeated('━', width - lit), ink(RGB.track))
}

function foot(stage: Stage, reading: Reading, progress: Channel): void {
	tally(stage, reading, progress)
	bar(stage, reading)
}

// The panel as the clue analysis.
function analysis(draw: ThemeDraw): void {
	const { s, tick } = draw
	const stage = stage_of(draw)
	const reading = reading_of(s.progress)

	clear_pane(stage.pane)
	head(stage, s.progress, tick)
	subject(stage, s.progress)
	level_bars(stage, reading, tick)
	reticle(stage.pane, { x: ANALYSIS.reticle_x, y: stage.body + 1 }, reading.share, tick)
	readout(stage, reading, phase_of(s.progress, tick))
	foot(stage, reading, s.progress)
}

// How far the board has gone into scan mode: easing in as the line starts, back out once it has typed.
function scan_share(progress: Channel, tick: number): number {
	if (progress.is_typing) return share_of(tick, progress.start, SCAN_MODE.ease_in)

	return 1 - share_of(progress.cooled, 0, SCAN_MODE.ease_out)
}

// Scan mode: the board's own text under the header eases to grey-blue; what the theme draws stays bright.
function scan_mode(draw: ThemeDraw): void {
	const share = scan_share(draw.s.progress, draw.tick)

	if (share <= 0) return
	const dimmed = ink(mix(RGB.text, RGB.steel, share * SCAN_MODE.dim))

	restyle(
		draw.grid,
		([, style], _, y) => style === 'body' && y >= SCAN_MODE.header_rows,
		() => dimmed,
	)
}

// One small reticle bracket on the data, at a place its number and the beat fix.
function bracket(pane: Pane, beat: number, index: number): void {
	const room = Math.max(1, pane.box.w - SCAN_MODE.margin)
	const x = Math.floor(hash(beat, index, SCAN_MODE.salt_x) * room)
	const y = Math.floor(hash(beat, index, SCAN_MODE.salt_y) * pane.box.h)
	const inks = index % PAIR === 0 ? [RGB.yellow, RGB.blue] : [RGB.blue, RGB.yellow]

	put_in(pane, { x, y }, '⌜', bold(inks[0] ?? RGB.yellow))
	put_in(pane, { x: x + SCAN_MODE.span, y }, '⌟', bold(inks[1] ?? RGB.blue))
}

// The brackets hop to new data every few ticks while the line types.
function hopping_brackets(draw: ThemeDraw): void {
	if (!draw.s.progress.is_typing) return
	const pane = data_pane(draw)
	const beat = Math.floor(draw.tick / SCAN_MODE.hop)

	for (let index = 0; index < SCAN_MODE.brackets; index++) bracket(pane, beat, index)
}

const run_board_theme_rk800_analysis = {
	analysis,
	hopping_brackets,
	is_analyzing,
	scan_mode,
	scan_share,
}

export { run_board_theme_rk800_analysis }
