import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardRow, RowReason } from './run-board-layout'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4288: a queued or waiting row draws `<wait icon> <condition column> <number>`, the
// column one width in both sections, so every row's number starts in one column.

const { CONDITION_WIDTH, condition_of, waits_of } = run_board_render_condition
const { EMPTY_LAYOUT, NOW, header, lines_of } = run_board_render_fixture
const { WAIT_ICONS, day_minute_of } = run_board_labels
const SECOND = 1000
const STOOD_SECONDS = 42
const BLOCKER = '3409'
const OTHER = '3410'
const LAST = '3411'
const CROSS_REPO = 'joshuafolkken/josh#88'

function row(number: number, reason?: RowReason, waits: Array<string> = []): BoardRow {
	return {
		number,
		title: undefined,
		state: 'waiting',
		status: undefined,
		kind: undefined,
		waits,
		reason,
	}
}

// A stand-in for the terminal link: an OSC 8 escape, which draws nothing, around the reference.
function osc_link(reference: string): string {
	return `\u{1B}]8;;https://example.test/${reference}\u{7}${reference}\u{1B}]8;;\u{7}`
}

describe('run_board_render_condition.condition_of', () => {
	it('is as wide as a 📅 row’s start time, the widest value', () => {
		expect(CONDITION_WIDTH).toBe(day_minute_of(0).length)
		expect(CONDITION_WIDTH).toBe('MM-DD HH:MM'.length)
	})

	it('pads every value, and no condition, to the one width', () => {
		const values = [
			row(1),
			row(2, { icon: WAIT_ICONS.lane, value: '4/4' }),
			row(3, { icon: WAIT_ICONS.not_before, value: day_minute_of(NOW) }),
			row(4, { since_ms: NOW - STOOD_SECONDS * SECOND }),
		].map((waiting) => condition_of(waiting, header()))

		expect(values.map((value) => value.length)).toStrictEqual(values.map(() => CONDITION_WIDTH))
		expect(values[3]).toBe('42″'.padEnd(CONDITION_WIDTH))
	})

	it('pads a linked issue on its drawn width, as the escape draws nothing', () => {
		const value = condition_of(row(1, { issues: [BLOCKER] }), header({ link: osc_link }))

		expect(run_board_fit.width_of(value)).toBe(CONDITION_WIDTH)
		expect(value).toContain(osc_link(BLOCKER))
	})

	it('names the first issue, with +N for the issues after it', () => {
		const value = condition_of(row(1, { issues: [BLOCKER, OTHER, LAST] }), header())

		expect(value).toBe(`${BLOCKER}+2`.padEnd(CONDITION_WIDTH))
	})

	it('leaves the column blank where a cross-repo reference would overrun it', () => {
		const value = condition_of(row(1, { issues: [CROSS_REPO, OTHER] }), header())

		expect(value).toBe(' '.repeat(CONDITION_WIDTH))
	})
})

describe('run_board_render_condition.waits_of', () => {
	const reason = { icon: WAIT_ICONS.blocker, issues: [BLOCKER, OTHER, LAST] }
	const blocked = row(1, reason, [BLOCKER, OTHER, LAST])

	it('follows a conditioned row’s title with the issues after the first', () => {
		expect(waits_of(blocked, header(), true)).toBe(`${OTHER}, ${LAST}`)
		expect(waits_of(row(2, { issues: [BLOCKER] }, [BLOCKER]), header(), true)).toBeUndefined()
	})

	it('follows any other row’s title with 🔗 and every blocker still standing', () => {
		expect(waits_of(blocked, header())).toBe(`🔗 ${BLOCKER}, ${OTHER}, ${LAST}`)
		expect(waits_of(row(2), header())).toBeUndefined()
	})

	it('keeps 🔗 and every blocker on a conditioned row whose wait names no issue, as a stalled one', () => {
		const stalled = row(3, { tail: 'fullrun #3' }, [BLOCKER, OTHER])

		expect(waits_of(stalled, header(), true)).toBe(`🔗 ${BLOCKER}, ${OTHER}`)
	})

	it('follows a conditioned row’s title with every issue when the first overruns the column', () => {
		const cross = row(4, { issues: [CROSS_REPO, OTHER] }, [CROSS_REPO, OTHER])

		expect(waits_of(cross, header(), true)).toBe(`${CROSS_REPO}, ${OTHER}`)
	})
})

describe('run_board_render.render — the condition column across sections', () => {
	const queued = { kind: 'row' as const, row: row(5, { icon: WAIT_ICONS.lane, value: '4/4' }) }
	const waiting = row(1234, { icon: WAIT_ICONS.blocker, issues: [BLOCKER] }, [BLOCKER])
	const layout = { ...EMPTY_LAYOUT, queued: [queued], unreached: [waiting] }
	const lines = lines_of(header({ layout }))

	it('starts every queued and waiting row’s number in one column', () => {
		const queued_line = lines.find((line) => line.startsWith(`  ${WAIT_ICONS.lane} `)) ?? ''
		const waiting_line = lines.find((line) => line.startsWith(`  ${WAIT_ICONS.blocker} `)) ?? ''

		expect(queued_line.indexOf(' 5')).toBe(waiting_line.indexOf(' 1234'))
		expect(queued_line).not.toBe('')
	})

	// joshuafolkken/kit#4294: 🧍 names the first lane it waits for in the column, the rest after the title.
	it('draws a run:solo row and a row behind it in the same column', () => {
		const solo = row(4287, { icon: WAIT_ICONS.solo, issues: ['4288', '4268'] })
		const behind = row(4269, { icon: WAIT_ICONS.solo_ahead, issues: ['4287'] })
		const rows = [solo, behind].map((entry) => ({ kind: 'row' as const, row: entry }))
		const drawn = lines_of(header({ layout: { ...EMPTY_LAYOUT, queued: rows } }))
		const solo_line = drawn.find((line) => line.startsWith(`  ${WAIT_ICONS.solo} `)) ?? ''
		const behind_line = drawn.find((line) => line.startsWith(`  ${WAIT_ICONS.solo_ahead} `)) ?? ''

		expect(solo_line).toContain(`4288+1${' '.repeat(CONDITION_WIDTH - '4288+1'.length)} 4287`)
		expect(solo_line.endsWith('4268')).toBe(true)
		expect(solo_line.indexOf(' 4287')).toBe(behind_line.indexOf(' 4269'))
	})

	it('draws each row’s wait icon once', () => {
		const waiting_line = lines.find((line) => line.includes('1234')) ?? ''

		expect(waiting_line.split(WAIT_ICONS.blocker)).toHaveLength(2)
		expect(waiting_line.endsWith('1234')).toBe(true)
	})
})
