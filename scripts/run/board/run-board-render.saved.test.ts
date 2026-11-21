import { describe, expect, it, vi } from 'vitest'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#8219: while the plan drawn is a saved one, the rows only the plan knows — the ones
// waiting on a decision, queued or waiting on another issue — are drawn faint; the lanes are not.

vi.mock('./run-board-faint', () => ({
	run_board_faint: { faint: (line: string) => `«${line}»`, faint_in: (line: string) => line },
}))

const { header } = run_board_render_fixture

function row(number: number, state: BoardRow['state']): BoardRow {
	return {
		number,
		title: `issue ${String(number)}`,
		kind: undefined,
		state,
		status: undefined,
		waits: [],
	}
}

const LAYOUT: BoardLayout = {
	active: [row(1, 'running')],
	queued: [{ kind: 'row', row: row(2, 'paused') }],
	people: [row(3, 'parked')],
	unreached: [row(4, 'paused')],
}

function line_with(lines: ReadonlyArray<string>, title: string): string {
	return lines.find((line) => line.includes(title)) ?? ''
}

function drawn(plan_saved_ms: number | undefined): Array<string> {
	return run_board_render.render({ header: header({ layout: LAYOUT, plan_saved_ms }), notes: [] })
}

describe('run_board_render.render with a saved plan', () => {
	const saved = drawn(header().now_ms)

	it.each(['issue 2', 'issue 3', 'issue 4'])('draws the plan row %s faint', (title) => {
		expect(line_with(saved, title)).toMatch(/^«.*»$/u)
	})

	it('draws the plan figures of the header faint and the running count as it is', () => {
		const progress = line_with(saved, '🕘')

		expect(progress).toMatch(/«✅ [^»]*»/u)
		expect(progress).toMatch(/(?<!«)🔄 \d/u)
	})

	it('draws the lane row as it is', () => {
		expect(line_with(saved, 'issue 1')).not.toContain('«')
	})

	it('draws no row faint for a fresh plan', () => {
		const fresh = drawn(undefined)

		expect(
			['issue 2', 'issue 3', 'issue 4'].map((title) => line_with(fresh, title)),
		).not.toContainEqual(expect.stringContaining('«'))
	})
})
