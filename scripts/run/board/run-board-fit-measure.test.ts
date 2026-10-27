import { styleText } from 'node:util'
import string_width from 'string-width'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type FrameParts, type PlanLine } from './run-board-fit'

vi.mock('string-width', async (original) => {
	const actual = await original<{ default: typeof string_width }>()

	return { default: vi.fn(actual.default) }
})

// joshuafolkken/kit#5185: a fit weighs a frame for every cut of its order, each repeating most of the
// last one's lines, and the next redraw draws nearly the same lines, so a line is measured once, and a
// line of printable ASCII never by `string-width` — the redraw the live spinner waits on stays short.
// The widths are kept across calls, so each test draws lines of its own.

const { fit, whole, width_of } = run_board_fit
const ROWS = 30
const SIZE = { rows: 8, columns: 80 }

function row(label: string, index: number): PlanLine {
	return { text: `  🟢 ${label} ${String(index)}`, row: { stage: 'pending', at_ms: undefined } }
}

// A plan of emoji rows far taller than the pane, so the fit weighs a frame for each row it cuts.
function tall(label: string): FrameParts {
	return {
		above: [`⏳ ${label}`],
		plan: [{ head: [''], lines: Array.from({ length: ROWS }, (_, index) => row(label, index)) }],
		notes: { head: [], lines: [], hidden: 0 },
		legend: ['', `🟢 legend ${label}`],
		footer: ['', `⌨ footer ${label}`],
	}
}

function measured(): Array<string> {
	return vi.mocked(string_width).mock.calls.map(([text]) => text)
}

afterEach(() => {
	vi.mocked(string_width).mockClear()
})

describe('run_board_fit.fit measuring', () => {
	it('measures each line once however many frames it weighs', () => {
		fit(tall('once'), SIZE)

		expect(measured().length).toBeGreaterThan(0)
		expect(new Set(measured()).size).toBe(measured().length)
	})

	it('measures no more lines than the uncut frame holds', () => {
		const parts = tall('uncut')

		fit(parts, SIZE)

		expect(measured().length).toBeLessThanOrEqual(whole(parts).length)
	})

	it('measures nothing again when the same frame is fitted on the next redraw', () => {
		const parts = tall('again')

		fit(parts, SIZE)
		vi.mocked(string_width).mockClear()

		expect(fit(parts, SIZE)).toHaveLength(SIZE.rows)
		expect(measured()).toStrictEqual([])
	})
})

describe('run_board_fit.width_of', () => {
	it('counts printable ASCII by its length without string-width, escapes taking none', () => {
		expect(width_of(styleText('dim', '  more 7'))).toBe(8)
		expect(measured()).toStrictEqual([])
	})

	it('measures emoji, CJK and control characters with string-width', () => {
		const lines = ['🔴 run', '待機中', 'a\tb']

		expect(lines.map((line) => width_of(line))).toStrictEqual([6, 6, 2])
		expect(measured()).toStrictEqual(lines)
	})
})
