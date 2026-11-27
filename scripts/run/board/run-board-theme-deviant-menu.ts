import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_parts, type Stage } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_tables } from './run-board-theme-deviant-tables'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeApi } from './run-board-theme-host-types'

// The deviant theme's menus. Their entrance, wherever a menu shows: the items enter one after
// another as bare steel-blue bars, their labels fade in, the bars fade away, and last the cursor
// plate fades in on the first item. The idle panel's pages in their turn. And its second page,
// CHAPTERS: one plate per lane the board runs — the selected one dark steel blue, the others lighter — stepping down to the right
// on thin right-angle lines, a slanted tile over each, the board's time under the selected one.

const { BOLD, bg, fg } = run_board_theme_host_grid
const { PAIR, put_in, share_of } = run_board_theme_draw
const { CURSOR, FACE, MODEL, PANEL, RGB } = run_board_theme_deviant_data
const { card_of, ink, mix } = run_board_theme_deviant_parts

const HALF = 1 / PAIR
// The entrance's pace; the OPENING's sounds read it too.
const { ENTER } = run_board_theme_deviant_tables
// The idle panel turns its page every fifteen seconds, through these in turn.
const PAGES = { ticks: 300, names: ['choices', 'chapters', 'status'] } as const

// The idle panel's page and the ticks since it turned up.
interface Page {
	name: (typeof PAGES.names)[number]
	age: number
}

const CHAPTERS = {
	title: 'C H A P T E R S',
	max: 3,
	tile: '◢████◤',
	step: 6,
	plate_w: 4,
	dot_x: 18,
	cross_x: 21,
}
const NUMBER = /^\d{3,6}/u
const WIRE = ink(RGB.plate)

// An entering item: how much of its bar shows, of its label, and of the cursor plate on it.
interface Entrance {
	bar: number
	label: number
	cursor: number
}

// A chapter's plate: its label and its place in the panel.
interface Chapter {
	label: string
	x: number
	y: number
}

// The chapters page at a tick: its plates and the ticks since it turned up.
interface ChapterPage {
	chapters: Array<Chapter>
	age: number
}

// Item `index` of `count`, `age` ticks into the entrance.
function entrance(age: number, index: number, count: number): Entrance {
	const labels = count * ENTER.step + ENTER.pause
	const fading = labels + ENTER.fade

	return {
		bar: age < index * ENTER.step ? 0 : 1 - share_of(age, fading, ENTER.fade),
		label: share_of(age, labels, ENTER.fade),
		cursor: share_of(age, fading + ENTER.fade, ENTER.fade),
	}
}

// The ticks an entrance of `count` items takes before the cursor plate starts to fade in.
function entrance_ticks(count: number): number {
	return count * ENTER.step + ENTER.pause + ENTER.fade * PAIR
}

function has_entered(enter: Entrance): boolean {
	return enter.bar > 0 || enter.label > 0
}

// An entering item's style over the ground `under`: white on its bar, `final` once the bar has gone.
function bar_style(enter: Entrance, under: string, final: string): string {
	const ground = mix(under, RGB.steel, enter.bar)
	const lit = enter.bar > HALF ? RGB.white : final

	return `${fg(mix(ground, lit, enter.label))}${bg(ground)}`
}

// How lit item `index`'s cursor plate is `tick` ticks after the entrance: fading in on the cursor's
// item, out on the one it left; none on the others. The cursor does not slide; one item alone keeps it.
function plate_share(index: number, tick: number, count: number): number | undefined {
	if (count === 1) return Math.min(1, tick / CURSOR.fade)
	const turn = Math.floor(tick / CURSOR.hold)
	const fade = (tick % CURSOR.hold) / CURSOR.fade

	if (index === turn % count) return fade
	const is_before = index === (turn + count - 1) % count && fade < 1

	return is_before ? 1 - fade : undefined
}

// The idle panel's page at `tick`: the choice list, the chapters, then the status
// (`run-board-theme-deviant-status.ts`), each from its own entrance.
function page_of(tick: number): Page {
	const turn = Math.floor(tick / PAGES.ticks) % PAGES.names.length

	return { name: PAGES.names[turn] ?? 'choices', age: tick % PAGES.ticks }
}

// The lanes the board runs that a plate stands for, by their rows: each one's issue number as its
// plate's label.
function lanes_of(api: ThemeApi): Array<{ label: string; y: number }> {
	const { lane_rows, issue_x } = api.layout
	const lanes = lane_rows.map((y) => ({
		y,
		label: `#${NUMBER.exec(api.plain(y).slice(Math.max(0, issue_x)))?.[0] ?? ''}`,
	}))

	return lanes.filter((lane) => lane.label.length > 1).slice(0, CHAPTERS.max)
}

// A plate's label for each lane the board runs; the board's own name where it runs none.
function lane_labels(api: ThemeApi): Array<string> {
	const labels = lanes_of(api).map((lane) => lane.label)

	return labels.length === 0 ? [MODEL.board] : labels
}

// The item the cursor is on `since` ticks after the entrance, and the ticks since it moved there.
function cursor_at(since: number, count: number): { index: number; moved: number } {
	return { index: Math.floor(since / CURSOR.hold) % Math.max(1, count), moved: since % CURSOR.hold }
}

// The plates, each a row lower and further right than the one before; one that would reach the
// triangle is left out.
function chapters_of(draw: ThemeDraw, stage: Stage): Array<Chapter> {
	const limit = stage.right - FACE.back - 1
	const chapters: Array<Chapter> = []
	let x = 1

	for (const [index, label] of lane_labels(draw.api).entries()) {
		if (x + label.length + CHAPTERS.plate_w <= limit) {
			chapters.push({ label, x, y: stage.body + 1 + index })
		}

		x += label.length + CHAPTERS.step
	}

	return chapters
}

// A plate after the entrance: lighter blue, and dark steel blue with white bold text and corner
// brackets by its share of the selection.
function settled_plate(pane: Pane, chapter: Chapter, share: number): void {
	const { label, x, y } = chapter
	const corner = ink(mix(RGB.night, RGB.soft, share))
	const weight = share > HALF ? BOLD : ''
	const ground = bg(mix(RGB.soft, RGB.plate, share))

	put_in(pane, { x, y }, '⌜', corner)
	put_in(
		pane,
		{ x: x + 1, y },
		` ${label} `,
		`${fg(mix(RGB.ink, RGB.white, share))}${weight}${ground}`,
	)
	put_in(pane, { x: x + label.length + CHAPTERS.plate_w - 1, y }, '⌟', corner)
}

// A plate entering: a bare bar, then its label, the bar easing to the plate's own blue.
function entering_plate(pane: Pane, chapter: Chapter, enter: Entrance): void {
	const ground = mix(RGB.soft, RGB.steel, enter.bar)
	const style = `${fg(mix(ground, RGB.ink, enter.label))}${bg(ground)}`

	put_in(pane, { x: chapter.x + 1, y: chapter.y }, ` ${chapter.label} `, style)
}

// What stands round plate `index`: the slanted tile over it where the panel has the row, and the
// right-angle line down to the next plate.
function fittings(stage: Stage, chapters: ReadonlyArray<Chapter>, index: number): void {
	const { pane, body } = stage
	const [chapter, next] = [chapters[index], chapters[index + 1]]

	if (!chapter) return
	if (body === PANEL.body) put_in(pane, { x: chapter.x + 1, y: chapter.y - 1 }, CHAPTERS.tile, WIRE)
	if (!next) return
	put_in(pane, { x: next.x - PAIR, y: chapter.y }, '─┐', WIRE)
	put_in(pane, { x: next.x - 1, y: next.y }, '└', WIRE)
}

// The selected plate carries the board's time under it.
function time_line(draw: ThemeDraw, pane: Pane, chapter: Chapter): void {
	const card = card_of(draw.api)

	if (!card) return
	put_in(pane, { x: chapter.x + 1, y: chapter.y + 1 }, `${card.half} ${card.time}`, ink(RGB.soft))
}

// A plate after the entrance, by its share of the selection, the board's time under the selected one.
function selected_plate(draw: ThemeDraw, stage: Stage, chapter: Chapter, share: number): void {
	settled_plate(stage.pane, chapter, share)
	if (share > HALF) time_line(draw, stage.pane, chapter)
}

function chapter_item(draw: ThemeDraw, stage: Stage, page: ChapterPage, index: number): void {
	const chapter = page.chapters[index]
	const count = page.chapters.length
	const enter = entrance(page.age, index, count)

	if (!chapter || !has_entered(enter)) return
	const since = page.age - entrance_ticks(count)

	fittings(stage, page.chapters, index)
	if (since < 0) entering_plate(stage.pane, chapter, enter)
	else selected_plate(draw, stage, chapter, plate_share(index, since, count) ?? 0)
}

// The CHAPTERS page, `age` ticks after it turned up: its thin title with its small ornaments, and
// the plates.
function chapters_page(draw: ThemeDraw, stage: Stage, age: number): void {
	const { pane } = stage
	const chapters = chapters_of(draw, stage)
	const shown = entrance(age, 0, chapters.length).label

	put_in(pane, { x: 1, y: 1 }, CHAPTERS.title, ink(mix(RGB.night, RGB.soft, shown)))
	put_in(pane, { x: CHAPTERS.dot_x, y: 1 }, '·', WIRE)
	put_in(pane, { x: CHAPTERS.cross_x, y: 1 }, '+', WIRE)

	for (const index of chapters.keys()) chapter_item(draw, stage, { chapters, age }, index)
}

const run_board_theme_deviant_menu = {
	TILE: CHAPTERS.tile,
	bar_style,
	chapters_of,
	chapters_page,
	cursor_at,
	entrance,
	entrance_ticks,
	has_entered,
	lane_labels,
	lanes_of,
	page_of,
	plate_share,
}

export { run_board_theme_deviant_menu }
export type { Entrance, Page }
