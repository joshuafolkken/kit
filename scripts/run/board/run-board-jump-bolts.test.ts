import { describe, expect, it } from 'vitest'
import { run_board_jump_bolts, type BoltArea, type BoltLife } from './run-board-jump-bolts'
import { run_board_jump_paint } from './run-board-jump-paint'

// joshuafolkken/kit#8740: the bttf run up's small bolts, as the demo's BOLTS draws them.

const { ARC, HEAD_BACK, OLD_BACK, OLD_FG, WHITE, bolt_cells, bolts_born, bolts_of, stroke_of } =
	run_board_jump_bolts
const { noise } = run_board_jump_paint
const LETTERS = 40
const AREA: BoltArea = { columns: 130, rows: 27, letters: LETTERS }
const BOLT_MARKS = new Set('╲ ╱ │ ─ ┼ ╳'.split(' '))
const TURNS = new Set('╲ ╱'.split(' '))

// Every bolt born over the run up, each as it is in its first tick.
function every_bolt(): Array<BoltLife> {
	const ticks = Array.from({ length: LETTERS }, (_, index) => index - LETTERS)

	return ticks.flatMap((t) => bolts_of(t, LETTERS, noise).filter((life) => !life.is_old))
}

function shape_of(life: BoltLife): Array<string> {
	return stroke_of(life, AREA, noise).map(({ x, y, text }) => `${String(x)};${String(y)} ${text}`)
}

describe('run_board_jump_bolts.bolts_born — how many a tick', () => {
	it('rises from none on the first letter to 27 × 0.4 at the flood and 27 × 0.96 the tick before the jump', () => {
		expect(bolts_born(-LETTERS - 1, LETTERS)).toBe(0)
		expect(bolts_born(-LETTERS, LETTERS)).toBe(0)
		expect(bolts_born(-15, LETTERS)).toBe(Math.round(27 * 0.4))
		expect(bolts_born(-1, LETTERS)).toBe(Math.round(27 * (0.4 + (0.6 * 14) / 15)))
	})

	it('bears none from the jump on, through the flash', () => {
		expect([0, 1, 12].map((t) => bolts_born(t, LETTERS))).toStrictEqual([0, 0, 0])
	})

	it('reaches the same peak on a run up no longer than the flood', () => {
		expect(bolts_born(-1, 12)).toBe(bolts_born(-1, LETTERS))
	})
})

describe('run_board_jump_bolts.bolts_of — their lives', () => {
	it('shows about 40 at once in the last ticks before the jump', () => {
		const counts = [-3, -2, -1].map((t) => bolts_of(t, LETTERS, noise).length)

		expect(counts.every((count) => count >= 30 && count <= 50)).toBe(true)
	})

	it('lives one tick or two: born this tick, or the tick before for about half of them', () => {
		const lives = bolts_of(-1, LETTERS, noise)
		const old = lives.filter((life) => life.is_old)

		expect(lives.every((life) => life.born === (life.is_old ? -2 : -1))).toBe(true)
		expect(old.length).toBeGreaterThan(bolts_born(-2, LETTERS) * 0.2)
		expect(old.length).toBeLessThan(bolts_born(-2, LETTERS) * 0.8)
	})
})

describe('run_board_jump_bolts.stroke_of — a bolt’s shape', () => {
	it('is 2 to 5 cells of `╲╱│─┼╳`, every length drawn', () => {
		const strokes = every_bolt().map((life) => stroke_of(life, AREA, noise))

		expect(new Set(strokes.map((stroke) => stroke.length))).toStrictEqual(new Set([2, 3, 4, 5]))
		expect(strokes.flat().every((spot) => BOLT_MARKS.has(spot.text))).toBe(true)
	})

	it('zig-zags on about 7 steps in 10, `╲` and `╱` alternating, a kink on the rest', () => {
		const strokes = every_bolt().map((life) => stroke_of(life, AREA, noise).map(({ text }) => text))
		const steps = strokes.flat()
		const share = steps.filter((text) => TURNS.has(text)).length / steps.length
		const pairs = strokes.flatMap((stroke) =>
			stroke.slice(0, -1).map((text, at) => [text, ...stroke.slice(at + 1, at + 2)]),
		)
		const turn_pairs = pairs.filter((pair) => pair.every((text) => TURNS.has(text)))

		expect(share).toBeGreaterThan(0.6)
		expect(share).toBeLessThan(0.8)
		expect(turn_pairs.every(([before, after]) => before !== after)).toBe(true)
	})
})

describe('run_board_jump_bolts.stroke_of — a bolt’s colors', () => {
	it('draws a bolt the same in its second tick, dimmer: arc 0.65, the head on arc 0.15', () => {
		const old = bolts_of(-1, LETTERS, noise).filter((life) => life.is_old)
		const strokes = old.map((life) => stroke_of(life, AREA, noise))

		expect(old.map((life) => shape_of(life))).toStrictEqual(
			old.map((life) => shape_of({ ...life, is_old: false })),
		)
		expect(strokes.flat().every((spot) => spot.fg === OLD_FG)).toBe(true)
		expect(strokes.map((stroke) => stroke.map((spot) => spot.bg))).toStrictEqual(
			strokes.map((stroke) => stroke.map((_, step) => (step === 0 ? OLD_BACK : undefined))),
		)
	})

	it('lights a new bolt’s head white on arc 0.35, its body arc and about a third white', () => {
		const strokes = every_bolt().map((life) => stroke_of(life, AREA, noise))
		const heads = strokes.map(([head]) => head)
		const body = strokes.flatMap((stroke) => stroke.slice(1))
		const white = body.filter((spot) => spot.fg === WHITE).length / body.length

		expect(heads.every((head) => head?.fg === WHITE && head.bg === HEAD_BACK)).toBe(true)
		expect(
			body.every((spot) => (spot.fg === ARC || spot.fg === WHITE) && spot.bg === undefined),
		).toBe(true)
		expect(white).toBeGreaterThan(0.2)
		expect(white).toBeLessThan(0.45)
	})
})

describe('run_board_jump_bolts.bolt_cells', () => {
	it('is the same for the same tick and screen', () => {
		expect(bolt_cells(-1, AREA, noise)).toStrictEqual(bolt_cells(-1, AREA, noise))
	})

	it('draws only the steps on the screen, none on a screen with no rows', () => {
		const keys = [...bolt_cells(-1, AREA, noise).keys()]
		const screen = new Set(
			Array.from({ length: AREA.columns * AREA.rows }, (_, index) =>
				[index % AREA.columns, Math.floor(index / AREA.columns)].join(';'),
			),
		)

		expect(keys.length).toBeGreaterThan(0)
		expect(keys.every((key) => screen.has(key))).toBe(true)
		expect(bolt_cells(-1, { ...AREA, rows: 0 }, noise).size).toBe(0)
	})
})
