import { describe, expect, it } from 'vitest'
import type { Paint } from './run-board-labels'
import { run_board_rain, type Head, type RainCell, type Random, type Scene } from './run-board-rain'
import { run_board_rain_gradient } from './run-board-rain-gradient'

const { GLYPHS, RAIN_MS, REVEAL, WIPE, advanced, cell_of, cells_of, heads_of, hurried, passes } =
	run_board_rain
const { HEAD_RGB, paint_at } = run_board_rain_gradient

// The approved demo's values (joshuafolkken/kit#8352, 2026-11-20T12:40:04Z comment).
const DEMO_GLYPHS = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+<>'
const DEMO_HEAD = '225;255;225'
const DEMO_RAIN_MS = 45
// A random draw under the reroll odds, then one that picks glyph 32.
const REROLLED = [0.079, 0.5]
const HALF = 0.5
const SLOW = 0.55
const FAST = 1.3
const PRECISION = 6
const SEVEN = 7
const SCREEN_ROWS = 50
const SAMPLES = [0, 0.25, HALF, 0.999]
// A scene falling ten rows a frame with no tail, holding its pace for `hold_ms`.
const STEADY: Scene = {
	tail: { least: 0, spread: 0 },
	speed: { least: 10, spread: 0 },
	hold_ms: 0,
}

// A random source that answers the given values in turn, then the last one forever.
function sequence(...values: Array<number>): Random {
	let index = 0

	return () => {
		const value = values[Math.min(index, values.length - 1)] ?? 0

		index += 1

		return value
	}
}

function paint_in(cell: RainCell | undefined): unknown {
	return cell?.kind === 'drop' ? cell.paint : cell?.kind
}

function rgb_of(paint: Paint | undefined): unknown {
	return typeof paint === 'object' && 'rgb' in paint ? paint.rgb : paint
}

// A head with today's seven-cell tail.
function seven(at: number, speed: number): Head {
	return { at, speed, length: SEVEN }
}

// The gradient's paint of each cell of a seven-cell tail, from `distance` up.
function seven_paints(...distances: Array<number>): Array<Paint | undefined> {
	return distances.map((distance) => paint_at(distance, SEVEN))
}

function settled_glyph(place: { x: number; y: number }): string | undefined {
	return GLYPHS[(place.x * 31 + place.y * 17) % GLYPHS.length]
}

// The one head a screen one column wide draws, every random draw `value` but its start.
function drawn_head(scene: Scene, value: number): Head {
	const [head] = heads_of({ width: 1, height: SCREEN_ROWS }, scene, sequence(0, value, value))
	if (head === undefined) throw new Error('no head drawn')

	return head
}

// The row the single column's head is on in each frame of a pass.
function head_rows(scene: Scene, height: number): Array<number> {
	return [...passes({ width: 1, height }, () => 0, scene)].map((frame) =>
		frame.findIndex((row) => row[0]?.kind === 'drop' && rgb_of(row[0].paint) === DEMO_HEAD),
	)
}

describe('run_board_rain heads', () => {
	it('rain draws each column its start, speed and tail in turn', () => {
		const heads = heads_of({ width: 2, height: 10 }, REVEAL, sequence(HALF, 0, 0, 0.25, 0.99, 0.99))

		expect(heads[0]).toEqual({ at: -12, speed: SLOW, length: 10 })
		expect(heads[1]?.at).toBe(-6)
		expect(heads[1]?.speed).toBeCloseTo(SLOW + 0.99 * 0.75, PRECISION)
		expect(heads[1]?.length).toBe(20)
		expect(RAIN_MS).toBe(DEMO_RAIN_MS)
	})

	it.each(SAMPLES)('reveal tail is round(H × (1 + %s)), one to two screens long', (value) => {
		const head = drawn_head(REVEAL, value)

		expect(head).toHaveLength(Math.round(SCREEN_ROWS * (1 + value)))
		expect(head.length).toBeGreaterThanOrEqual(SCREEN_ROWS)
		expect(head.length).toBeLessThanOrEqual(2 * SCREEN_ROWS)
		expect(head.speed).toBeCloseTo(SLOW + value * 0.75, PRECISION)
	})

	it.each(SAMPLES)('wipe tail is round(H × (0.4 + %s × 0.6)), at twice the pace', (value) => {
		const head = drawn_head(WIPE, value)

		expect(head).toHaveLength(Math.round(SCREEN_ROWS * (0.4 + value * 0.6)))
		expect(head.length).toBeGreaterThanOrEqual(0.4 * SCREEN_ROWS)
		expect(head.length).toBeLessThanOrEqual(SCREEN_ROWS)
		expect(head.speed).toBeCloseTo(1.1 + value * 1.5, PRECISION)
	})

	it('rain advances each column by its own speed', () => {
		const moved = advanced(advanced([seven(0, SLOW), seven(0, FAST)]))
		const [, row] = cells_of(moved, 2, () => HALF)

		expect(moved.map((head) => head.at)).toEqual([2 * SLOW, 2 * FAST])
		expect(row?.[0]).toMatchObject({ paint: { rgb: DEMO_HEAD } })
		expect(row?.[1]).toMatchObject({ paint: { rgb: HEAD_RGB[1] } })
	})
})

describe('run_board_rain pace', () => {
	it.each([
		['reveal', REVEAL],
		['wipe', WIPE],
	])('%s holds its pace for three seconds, then gains one more each second', (_name, scene) => {
		expect([0, 3000, 3500, 5000].map((elapsed_ms) => hurried(scene, elapsed_ms))).toEqual([
			1, 1, 1.5, 3,
		])
	})

	it('rain falls at its own pace through the hold', () => {
		expect(head_rows({ ...STEADY, hold_ms: 3000 }, 40)).toEqual([0, 10, 20, 30])
	})

	it('rain falls faster each frame past the hold', () => {
		// Each frame's step one `RAIN_MS` faster than the one before.
		expect(head_rows(STEADY, 40)).toEqual([0, 10, 20, 31])
	})

	it('rain ends once the slowest column tail falls past the bottom row', () => {
		const scene: Scene = {
			...STEADY,
			tail: { least: 1, spread: 0 },
			speed: { least: 1, spread: 1 },
			hold_ms: 9000,
		}
		const frames = [...passes({ width: 2, height: 2 }, sequence(0, 0.999, 0, 0, 0, 0), scene)]

		expect(frames).toHaveLength(4)
		expect(frames.at(-1)?.map((row) => paint_in(row[0]))).toEqual(['behind', 'behind'])
		expect(frames.at(-1)?.map((row) => paint_in(row[1]))).toEqual(['behind', paint_at(2, 2)])
	})
})

describe('run_board_rain gradient', () => {
	it('rain draws its two lead cells a fresh glyph every frame', () => {
		const head = seven(4, SLOW)
		const leads = [{ y: 4 }, { y: 3 }].map(({ y }) => ({ x: 2, y }))
		const frames = [0.1, 0.9].map((value) =>
			leads.map((place) => cell_of(head, place, () => value)),
		)

		const drawn = [0.1, 0.9].map((value) => run_board_rain.fresh(() => value))

		expect(frames[0]?.map((cell) => cell.kind === 'drop' && cell.glyph)).toEqual([
			drawn[0],
			drawn[0],
		])
		expect(frames[1]?.map((cell) => cell.kind === 'drop' && cell.glyph)).toEqual([
			drawn[1],
			drawn[1],
		])
		expect(drawn[0]).not.toBe(drawn[1])
	})

	it('rain glints a tail cell only on the frame it rerolls', () => {
		const head = seven(8, SLOW)
		const tail = { x: 0, y: 3 }

		const kept = cell_of(head, tail, () => 0.9)
		const rerolled = cell_of(head, tail, sequence(...REROLLED))
		const lead_rerolled = cell_of(head, { x: 0, y: 6 }, sequence(...REROLLED))

		expect(paint_in(rerolled)).toEqual(paint_at(5, SEVEN, true))
		expect(paint_in(kept)).toEqual(paint_at(5, SEVEN))
		expect(paint_in(lead_rerolled)).toEqual(paint_at(2, SEVEN))
	})
})

describe('run_board_rain cells', () => {
	it('rain preserves the approved glyphs and paints the gradient up its tail', () => {
		const head = seven(8.4, SLOW)
		const column = Array.from({ length: 10 }, (_row, y) => cell_of(head, { x: 0, y }, () => HALF))

		expect(GLYPHS).toBe(DEMO_GLYPHS)
		expect(column[9]).toEqual({ kind: 'ahead' })
		expect(column[8]).toMatchObject({ glyph: GLYPHS[32], paint: { rgb: DEMO_HEAD } })
		expect(column.slice(1, 8).map((cell) => paint_in(cell))).toEqual(
			seven_paints(7, 6, 5, 4, 3, 2, 1),
		)
		expect(column[0]).toEqual({ kind: 'behind' })
	})

	it('rain keeps coordinate glyphs with the approved reroll probability', () => {
		const head = seven(4, SLOW)
		const later = seven(4.9, SLOW)
		const place = { x: 2, y: 1 }
		const kept = settled_glyph(place)

		expect(cell_of(head, place, () => 0.08)).toMatchObject({ glyph: kept })
		expect(cell_of(later, place, () => 0.9)).toMatchObject({ glyph: kept })
		expect(cell_of(head, place, sequence(...REROLLED))).toMatchObject({ glyph: GLYPHS[32] })
	})
})
