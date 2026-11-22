import { describe, expect, it } from 'vitest'
import { run_board_frame_diff } from './run-board-frame-diff'
import type { KeyedLine } from './run-board-type-rows'

const GREEN = '\u{1B}[32m'
const RED = '\u{1B}[31m'

function line(text: string, key = 'lane:1', row = 1): KeyedLine {
	return { text, key, row, index: row - 1, prefix_columns: 0 }
}

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

	it('keeps wide replacement glyphs whole and emits nothing for erased cells', () => {
		const changed = run_board_frame_diff.changed([line('abc')], [line('界')])

		expect(changed.map(({ text, column }) => ({ text, column }))).toStrictEqual([
			{ text: '界', column: 1 },
		])
		expect(run_board_frame_diff.changed([line('界')], [line('')])).toStrictEqual([])
	})
})
