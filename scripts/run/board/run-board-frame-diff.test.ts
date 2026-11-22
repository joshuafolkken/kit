import { describe, expect, it } from 'vitest'
import { run_board_frame_diff } from './run-board-frame-diff'
import type { KeyedLine } from './run-board-type-rows'

const GREEN = '\u{1B}[32m'
const RED = '\u{1B}[31m'
const SUPERVISOR = 'flash:process:▶ backlogrun:supervisor'

function line(text: string, key = 'lane:1', row = 1): KeyedLine {
	return { text, key, row, index: row - 1, prefix_columns: 0 }
}

function keys_of(before: ReadonlyArray<KeyedLine>, after: ReadonlyArray<KeyedLine>): Array<string> {
	return run_board_frame_diff.events(before, after).map((event) => event.key)
}

describe('run_board_frame_diff.events', () => {
	it('ac-3a46d3cd fires for a lane that newly failed', () => {
		expect(
			keys_of([line('🔨 #1 3m', 'lanes:1')], [line('💥 #1 4m 🚢💥', 'lanes:1')]),
		).toStrictEqual(['lanes:1'])
		expect(keys_of([line('🚢💥 🔨', 'lanes:1')], [line('🚢💥 🚢💥', 'lanes:1', 4)])).toStrictEqual([
			'lanes:1',
		])
	})

	it('ac-3a46d3cd fires for another supervisor taking over', () => {
		const before = [line('🧭 supervisor 1%', `${SUPERVISOR}:100`, 9)]

		expect(keys_of(before, [line('🧭 supervisor 9%', `${SUPERVISOR}:200`, 9)])).toStrictEqual([
			`${SUPERVISOR}:200`,
		])
	})

	it.each([
		['the first frame', [], [line('💥', 'lanes:1')]],
		['a redraw of the same failure', [line('💥', 'lanes:1')], [line(`${GREEN}💥`, 'lanes:1')]],
		['an ordinary value change', [line('🔨 3m', 'lanes:1')], [line('🔨 4m', 'lanes:1')]],
		['a moved row', [line('💥 a', 'lanes:1')], [line('💥 a', 'lanes:1', 5)]],
		['a recovered lane', [line('🚢💥 💥', 'lanes:1')], [line('🚢💥 🔨', 'lanes:1')]],
		['a row other than a lane', [line('a', 'note:1')], [line('💥', 'note:1')]],
		['a supervisor starting', [line('a', SUPERVISOR)], [line('a', `${SUPERVISOR}:1`)]],
		['a supervisor stopping', [line('a', `${SUPERVISOR}:1`)], [line('a', SUPERVISOR)]],
		['the same supervisor', [line('1%', `${SUPERVISOR}:1`)], [line('5%', `${SUPERVISOR}:1`)]],
	])('ac-3a46d3cd does not fire for %s', (_name, before, after) => {
		expect(keys_of(before, after)).toStrictEqual([])
	})
})

describe('run_board_frame_diff.changed', () => {
	it('ac-713cb5e6 compares graphemes by display column, retaining ANSI styles', () => {
		const changed = run_board_frame_diff.changed([line('界a1')], [line(`${GREEN}界a2`)])

		expect(changed).toStrictEqual([{ text: '2', column: 4, style: GREEN, key: 'lane:1', row: 1 }])
	})

	it('ac-f47d6b16 ignores identical text and color-only changes', () => {
		expect(run_board_frame_diff.changed([line(`${GREEN}界a`)], [line(`${RED}界a`)])).toStrictEqual(
			[],
		)
		expect(run_board_frame_diff.changed([line('a')], [line('a')])).toStrictEqual([])
	})

	it('ac-713cb5e6 establishes a base for first, new and moved rows', () => {
		expect(run_board_frame_diff.changed([], [line('a')])).toStrictEqual([])
		expect(run_board_frame_diff.changed([line('a')], [line('b', 'lane:2')])).toStrictEqual([])
		expect(run_board_frame_diff.changed([line('a')], [line('b', 'lane:1', 2)])).toStrictEqual([])
	})

	it('ignores a semantic replacement at the same body position', () => {
		const before = [line('old', 'flash:quota:claude', 3), line('a')]
		const after = [line('new', 'flash:quota:codex', 3), line('a', 'lane:2')]

		expect(run_board_frame_diff.changed(before, after)).toStrictEqual([])
	})

	it('counts frames on the spinner beat from the start frame', () => {
		const { FRAME_MS, frames_between } = run_board_frame_diff

		expect(frames_between(FRAME_MS - 1, FRAME_MS * 3)).toBe(3)
		expect(frames_between(FRAME_MS, FRAME_MS)).toBe(0)
	})

	it('keeps wide replacement glyphs whole and emits nothing for erased cells', () => {
		const changed = run_board_frame_diff.changed([line('abc')], [line('界')])

		expect(changed.map(({ text, column }) => ({ text, column }))).toStrictEqual([
			{ text: '界', column: 1 },
		])
		expect(run_board_frame_diff.changed([line('界')], [line('')])).toStrictEqual([])
	})
})

describe('run_board_frame_diff.departures', () => {
	it('ac-066a13f7 names the lane rows the last frame drew and this one does not', () => {
		const merged = line('🚢 #1', 'lanes:1', 4)
		const before = [merged, line('🔨 #2', 'lanes:2', 5), line('now', 'now:x', 6)]
		const after = [line('🔨 #2', 'lanes:2', 4)]

		expect(run_board_frame_diff.departures(before, after)).toStrictEqual([merged])
	})

	it('names no row that stays or that is not a lane', () => {
		const before = [line('🔨 #2', 'lanes:2', 5), line('now', 'now:x', 6)]

		expect(run_board_frame_diff.departures(before, [line('🔨 #2', 'lanes:2', 3)])).toStrictEqual([])
	})

	it('leaves the events unchanged when a lane row leaves', () => {
		expect(keys_of([line('🔨 #1', 'lanes:1')], [])).toStrictEqual([])
	})
})
