import { describe, expect, it } from 'vitest'
import { run_board_rain, type RainCell, type Random } from './run-board-rain'

const { FADE, GLYPHS, RAIN_MS, advanced, cell_of, cells_of, heads_of, passes } = run_board_rain

// The approved demo's values (joshuafolkken/kit#8352, 2026-11-20T12:40:04Z comment).
const DEMO_GLYPHS = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:.=*+<>'
const DEMO_HEAD = '225;255;225'
const DEMO_FADE = [
	'0;255;65',
	'0;255;65',
	'0;215;60',
	'0;165;40',
	'0;165;40',
	'0;100;22',
	'0;55;12',
]
const DEMO_RAIN_MS = 45
const HALF = 0.5
const SLOW = 0.55
const FAST = 1.3
const PRECISION = 6

// A random source that answers the given values in turn, then the last one forever.
function sequence(...values: Array<number>): Random {
	let index = 0

	return () => {
		const value = values[Math.min(index, values.length - 1)] ?? 0

		index += 1

		return value
	}
}

function paint_of(cell: RainCell | undefined): unknown {
	return cell?.kind === 'drop' ? cell.paint : cell?.kind
}

function settled_glyph(place: { x: number; y: number }): string | undefined {
	return GLYPHS[(place.x * 31 + place.y * 17) % GLYPHS.length]
}

describe('run_board_rain heads', () => {
	it('rain uses independent column speeds and start delays', () => {
		const heads = heads_of(2, sequence(HALF, 0, 0.25, 0.99))

		expect(heads[0]).toEqual({ at: -12, speed: SLOW })
		expect(heads[1]?.at).toBe(-6)
		expect(heads[1]?.speed).toBeCloseTo(SLOW + 0.99 * 0.75, PRECISION)
		expect(RAIN_MS).toBe(DEMO_RAIN_MS)
	})

	it('rain advances each column by its own speed', () => {
		const moved = advanced(
			advanced([
				{ at: 0, speed: SLOW },
				{ at: 0, speed: FAST },
			]),
		)
		const [, row] = cells_of(moved, 2, () => HALF)

		expect(moved.map((head) => head.at)).toEqual([2 * SLOW, 2 * FAST])
		expect(row?.[0]).toMatchObject({ paint: { rgb: DEMO_HEAD } })
		expect(row?.[1]).toMatchObject({ paint: { rgb: DEMO_FADE[0] } })
	})

	it('rain passes until the last tail falls past the bottom row', () => {
		const frames = [...passes({ width: 1, height: 1 }, () => 0)]

		expect(frames).toHaveLength(15)
		expect(paint_of(frames.at(-1)?.[0]?.[0])).toEqual(FADE.at(-1))
	})
})

describe('run_board_rain cells', () => {
	it('rain preserves the approved glyphs and fade sequence', () => {
		const head = { at: 8.4, speed: SLOW }
		const column = Array.from({ length: 10 }, (_row, y) => cell_of(head, { x: 0, y }, () => HALF))

		expect(GLYPHS.join('')).toBe(DEMO_GLYPHS)
		expect(
			FADE.map((paint) => (typeof paint === 'object' && 'rgb' in paint ? paint.rgb : paint)),
		).toEqual(DEMO_FADE)
		expect(column[9]).toEqual({ kind: 'ahead' })
		expect(column[8]).toMatchObject({ glyph: GLYPHS[32], paint: { rgb: DEMO_HEAD } })
		expect(column.slice(1, 8).map((cell) => paint_of(cell))).toEqual(FADE.toReversed())
		expect(column[0]).toEqual({ kind: 'behind' })
	})

	it('rain keeps coordinate glyphs with the approved reroll probability', () => {
		const head = { at: 4, speed: SLOW }
		const later = { at: 4.9, speed: SLOW }
		const place = { x: 2, y: 3 }
		const kept = settled_glyph(place)

		expect(cell_of(head, place, () => 0.08)).toMatchObject({ glyph: kept })
		expect(cell_of(later, place, () => 0.9)).toMatchObject({ glyph: kept })
		expect(cell_of(head, place, sequence(0.079, HALF))).toMatchObject({ glyph: GLYPHS[32] })
	})
})
