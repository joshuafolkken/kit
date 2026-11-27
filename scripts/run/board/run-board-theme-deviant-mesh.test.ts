import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_deviant_mesh } from './run-board-theme-deviant-mesh'
import { run_board_theme_deviant_replay } from './run-board-theme-deviant-replay'
import { run_board_theme_deviant_scrub, type Scrub } from './run-board-theme-deviant-scrub'

// joshuafolkken/kit#9096: the deviant theme's reconstruction of the lane — the scan mesh, the
// fields' wireframe boxes, the ghosts and the scan inset.

const { boxes, built, ghosts, inset, mesh, scan_image, vein } = run_board_theme_deviant_mesh
const { BRIGHT } = run_board_theme_deviant_replay
const { scrub_of } = run_board_theme_deviant_scrub
const { HOST, draw_at, row_text } = run_board_theme_deviant_fixture
const PLAYING = 50
const TYPED = 400
const COUNT = '1/3'
// The mesh's rows in the pane, and the pane's first row on the board.
const PANE_TOP = HOST.layout.area_top + 1
const MESH_TOP = 2
// A field's box: its columns from the mesh's left, the head's column a cell past the track's start.
const FIELD = { text: 'ab', x: 22, w: 6 }
const TRACK_X = 6

function pane_row(scrub: Scrub, y: number): string {
	return row_text(scrub.pane.grid, PANE_TOP + y).slice(0, scrub.pane.box.w)
}

// The box's stage with the head playing at track cell `head`.
function built_at(scrub: Scrub, head: number): number {
	return built(FIELD, { ...scrub, is_rewinding: false, head })
}

describe('run_board_theme_deviant_mesh.built', () => {
	it('builds a box from its dots to dashes to solid as the head crosses it', () => {
		const scrub = { ...scrub_of(draw_at('r', PLAYING), COUNT), is_done: false }
		const heads = [FIELD.x - TRACK_X - 1, FIELD.x - TRACK_X, FIELD.x]

		expect(heads.map((head) => built_at(scrub, head))).toStrictEqual([0, 1, 2])
		expect(built(FIELD, { ...scrub, is_rewinding: true, head: FIELD.x })).toBe(0)
		expect(built(FIELD, { ...scrub, is_done: true, head: 0 })).toBe(2)
	})
})

describe('run_board_theme_deviant_mesh.vein', () => {
	it('is brightest on the vein and dark far from it', () => {
		const size = { w: 12, h: 4 }
		const levels = [0, 1, 2, 3].map((py) => vein(0, py, size))

		expect(levels.every((level) => level >= 0 && level <= 1)).toBe(true)
		expect(Math.max(...levels)).toBeGreaterThan(0)
		expect(vein(0, 40, size)).toBe(0)
	})
})

describe('run_board_theme_deviant_mesh drawing', () => {
	it('dots the mesh on blank cells right of the stamp, never over a drawn part', () => {
		const scrub = scrub_of(draw_at('r', PLAYING), COUNT)
		const rule_row = row_text(HOST.board, PANE_TOP + MESH_TOP + 1)

		mesh(scrub)
		expect(pane_row(scrub, MESH_TOP).slice(FIELD.x)).toMatch(/^· {3}·/u)
		expect(pane_row(scrub, MESH_TOP + 1)).toBe(rule_row.slice(0, scrub.pane.box.w))
	})

	it('frames the lane’s fields solid once the lane has typed', () => {
		const draw = draw_at('r', TYPED)
		const scrub = scrub_of(draw, COUNT)

		boxes(draw, scrub, BRIGHT)
		expect(pane_row(scrub, MESH_TOP)).toContain('┌ #8826 ┐')
		expect(pane_row(scrub, MESH_TOP + 1)).toContain('└───────┘')
	})

	it('draws no ghosts once the lane has typed', () => {
		const draw = draw_at('r', TYPED)
		const before = structuredClone(draw.grid)

		ghosts(draw, scrub_of(draw, COUNT))
		expect(draw.grid).toStrictEqual(before)
	})
})

describe('run_board_theme_deviant_mesh scan inset', () => {
	it('reveals the scan inset between its bracket corners once typed', () => {
		const draw = draw_at('r', TYPED)
		const scrub = scrub_of(draw, COUNT)

		inset(draw, scrub)
		expect(pane_row(scrub, MESH_TOP)).toMatch(/⌜▀{12}/u)
		expect(pane_row(scrub, MESH_TOP + 1)).toMatch(/▀{12}⌟/u)
	})

	it('reveals only the shown columns of the scan image', () => {
		const draw = draw_at('r', TYPED)
		const scrub = scrub_of(draw, COUNT)

		scan_image(scrub.pane, { x: 0, y: 0, w: 12, h: 2 }, { cols: 3, rows: 1 }, 0)
		expect(pane_row(scrub, 0).slice(0, 4)).toMatch(/^▀{3}[^▀]/u)
		expect(pane_row(scrub, 1)).not.toContain('▀')
	})
})
