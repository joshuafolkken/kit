import { describe, expect, it } from 'vitest'
import { run_board_fit, type FrameParts, type PlanLine } from './run-board-fit'
import { run_board_pinned_footer } from './run-board-pinned-footer'

// A pinned footer is drawn in place of the legend and the footer and is never cut: a short pane cuts
// the body over it, and one shorter than the pinned rows keeps the last of them. A frame with none is
// fit as `run-board-fit.ts` fits it.

const WIDE = 500
const PINNED = ['', 'picked', 'keys']

function row(text: string, at_ms: number): PlanLine {
	return { text, row: { stage: 'running', at_ms } }
}

const PARTS: FrameParts = {
	above: ['header'],
	plan: [{ head: ['rule'], lines: [row('one', 1), row('two', 2), row('three', 1 + 2)] }],
	notes: { head: [], lines: [], hidden: 0 },
	legend: ['', 'legend'],
	footer: ['', 'footer'],
}
const BODY = ['header', 'rule', 'one', 'two', 'three']

function pinned_in(rows: number | undefined): Array<string> {
	const size = rows === undefined ? undefined : { rows, columns: WIDE }

	return run_board_pinned_footer.fitted(PARTS, { size, pinned_footer: PINNED })
}

describe('run_board_pinned_footer.fitted with a pinned footer', () => {
	it('ends the frame on the pinned rows in place of the legend and the footer', () => {
		const whole = [...BODY, ...PINNED]

		expect(pinned_in(undefined)).toStrictEqual(whole)
		expect(pinned_in(whole.length)).toStrictEqual(whole)
	})

	it('cuts the body in a short pane and keeps every pinned row', () => {
		const lines = pinned_in(BODY.length + PINNED.length - 1)

		expect(lines.slice(-PINNED.length)).toStrictEqual(PINNED)
		expect(lines.slice(0, 2)).toStrictEqual(['header', 'rule'])
		expect(lines).not.toContain('one')
		expect(lines.length).toBeLessThan(BODY.length + PINNED.length)
	})

	it('keeps the pinned rows over the header in a pane that holds nothing else', () => {
		expect(pinned_in(PINNED.length + 1)).toStrictEqual(['header', ...PINNED])
		expect(pinned_in(PINNED.length)).toStrictEqual(PINNED)
	})

	it('keeps the last pinned rows in a pane shorter than they are', () => {
		expect(pinned_in(2)).toStrictEqual(PINNED.slice(1))
		expect(pinned_in(1)).toStrictEqual(PINNED.slice(2))
	})

	it('counts a pinned row wider than the pane by the rows it takes', () => {
		const size = { rows: 2 + 1, columns: 2 + 2 }
		const parts = { ...PARTS, above: ['head'] }
		const lines = run_board_pinned_footer.fitted(parts, { size, pinned_footer: ['pinned'] })

		expect(lines).toStrictEqual(['head', 'pinned'])
	})
})

describe('run_board_pinned_footer.fitted with no pinned footer', () => {
	it.each([2, BODY.length, BODY.length + 2, WIDE])('fits a pane of %i rows as the fit', (rows) => {
		const size = { rows, columns: WIDE }

		expect(run_board_pinned_footer.fitted(PARTS, { size })).toStrictEqual(
			run_board_fit.fit(PARTS, size),
		)
	})

	it('draws a frame with no pane whole, legend and footer too', () => {
		expect(run_board_pinned_footer.fitted(PARTS, {})).toStrictEqual(run_board_fit.whole(PARTS))
		expect(run_board_pinned_footer.fitted(PARTS, {}).slice(-2)).toStrictEqual(['', 'footer'])
	})
})
