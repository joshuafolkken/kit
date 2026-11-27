import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import {
	run_board_theme_deviant_menu,
	type Entrance,
	type Page,
} from './run-board-theme-deviant-menu'
import { run_board_theme_deviant_parts, type Stage } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_status, type StatusLook } from './run-board-theme-deviant-status'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'

// The deviant theme's idle panel: the model line with its blue chip and the waiting ring, the
// breathing triangle and the date card, round one of three pages that turn every fifteen seconds —
// the choice list whose cursor plate fades from line to line, the chapters
// (`run-board-theme-deviant-menu.ts`) and the status (`run-board-theme-deviant-status.ts`), whose
// readout takes the triangle's place; each page turns up by the menus' entrance. Through a NOTICE
// the panel shows the status page, and after its peak the model line carries SOFTWARE INSTABILITY.

const { bar_style, chapters_page, entrance, entrance_ticks, has_entered, page_of, plate_share } =
	run_board_theme_deviant_menu
const { PAIR, clear_pane, put_in } = run_board_theme_draw
const { CARD, CHOICES, CURSOR, FACE, MODEL, PANEL, RGB } = run_board_theme_deviant_data
const { bold, card_of, duo, ink, lay_date, mix, on, ornament, ring, stage_of, triangle } =
	run_board_theme_deviant_parts
const { is_notice, status_page } = run_board_theme_deviant_status

// How the panel stands: whether a NOTICE has peaked (the mark shows), whether its wall still builds
// (the ring red and quick), the hits the wall has taken (a chevron each), and the stress the level
// reads, which the status page's readout shows the other way.
interface PanelLook extends StatusLook {
	hits: number
}

// A NOTICE's page: the status, from no entrance.
const NOTICE_PAGE: Page = { name: 'status', age: 0 }

function lit_choice(pane: Pane, y: number, text: string, share: number): void {
	const corner = ink(mix(RGB.night, RGB.soft, share))

	put_in(pane, { x: 1, y }, '⌜', corner)
	put_in(pane, { x: CURSOR.plate_x, y }, text, on(RGB.white, mix(RGB.night, RGB.steel, share)))
	put_in(pane, { x: CURSOR.end_x, y }, '⌟', corner)
}

// A choice after the entrance: plain, or under the cursor plate by its share of it.
function settled_choice(pane: Pane, y: number, text: string, share: number | undefined): void {
	if (share === undefined) put_in(pane, { x: CURSOR.plate_x, y }, text, ink(RGB.soft))
	else lit_choice(pane, y, text, share)
}

// A choice entering: a bare bar, then its label on it, then the label alone.
function entering_choice(pane: Pane, y: number, text: string, enter: Entrance): void {
	if (!has_entered(enter)) return
	put_in(pane, { x: CURSOR.plate_x, y }, text, bar_style(enter, RGB.night, RGB.soft))
}

// Line `index` of the choice list, `age` ticks after the page turned up.
function choice(stage: Stage, index: number, age: number): void {
	const [sign = '', label = ''] = CHOICES[index] ?? []
	const y = stage.body + index
	const count = CHOICES.length
	const since = age - entrance_ticks(count)
	const text = ` ${sign} ${label.padEnd(CURSOR.label_w)} `

	if (since < 0) entering_choice(stage.pane, y, text, entrance(age, index, count))
	else settled_choice(stage.pane, y, text, plate_share(index, since, count))
}

// The choice list's page: the ornament line where the panel has the row, and the four choices.
function choices_page(stage: Stage, age: number): void {
	if (stage.body === PANEL.body) ornament(stage, 1)

	for (const index of CHOICES.keys()) choice(stage, index, age)
}

// The model's kind beside its name; given up where the mark would run over it. No serial: the one the
// source shows is unconfirmed.
function kind_of(stage: Stage, has_mark: boolean): string {
	const end = MODEL.x + MODEL.name.length + 1 + MODEL.kind.length

	return has_mark && end >= stage.right - MODEL.mark_back ? '' : MODEL.kind
}

function model_line(stage: Stage, tick: number, look: PanelLook): void {
	const { pane, right } = stage
	const mark_ink = tick % MODEL.blink < MODEL.blink_lit ? bold(RGB.red) : ink(RGB.red)
	const [turn, color] = look.is_alarm ? [tick * PAIR, RGB.red] : [tick, RGB.blue]

	put_in(pane, { x: 1, y: 0 }, '▌', bold(RGB.blue))
	duo(pane, { x: MODEL.x, y: 0 }, [MODEL.name, kind_of(stage, look.has_mark)], RGB.white)
	if (look.has_mark) put_in(pane, { x: right - MODEL.mark_back, y: 0 }, MODEL.mark, mark_ink)
	ring(pane, { x: right - 1, y: 0 }, turn, color)
}

// A chevron for each hit the wall has taken, climbing the panel's right edge under the ring.
function chevrons(stage: Stage, hits: number): void {
	const { pane, right, bottom } = stage

	for (let hit = 0; hit < Math.min(hits, bottom - 1); hit++) {
		put_in(pane, { x: right - 1, y: bottom - 1 - hit }, '▲', bold(RGB.red))
	}
}

function foot(draw: ThemeDraw, stage: Stage): void {
	const { pane, right, bottom } = stage
	const card = card_of(draw.api)

	if (card) lay_date(pane, { x: 1, y: bottom }, card, CARD.whole)
	put_in(pane, { x: right - MODEL.brand_back, y: bottom }, MODEL.brand, bold(RGB.soft))
}

// A menu's page and the triangle beside it.
function menu_page(draw: ThemeDraw, stage: Stage, page: Page): void {
	if (page.name === 'chapters') chapters_page(draw, stage, page.age)
	else choices_page(stage, page.age)
	triangle(stage.pane, { x: stage.right - FACE.back, y: stage.body }, draw.tick, RGB.blue)
}

// The idle panel, as `look` has it: at rest on the page whose turn it is, or through a NOTICE on
// the status page.
function idle(draw: ThemeDraw, look: PanelLook): void {
	const stage = stage_of(draw)
	const page = is_notice(look) ? NOTICE_PAGE : page_of(draw.tick)

	clear_pane(stage.pane)
	model_line(stage, draw.tick, look)
	if (page.name === 'status') status_page(stage, draw.tick, page.age, look)
	else menu_page(draw, stage, page)
	chevrons(stage, look.hits)
	foot(draw, stage)
}

const run_board_theme_deviant_panel = { idle }

export { run_board_theme_deviant_panel }
export type { PanelLook }
