import { describe, expect, it } from 'vitest'
import { board_compare_report } from './board-compare-report'

const { beats_of, compared, report } = board_compare_report
const SIZE = { columns: 8, rows: 2 }

describe('board_compare_report.beats_of', () => {
	it.each([
		['raw terminal bytes', '\u{1B}[?1049h\u{1B}[2J'],
		['a line without a wait', '{"text":"a"}\n'],
		['a line holding a number', '1\n'],
		['a line holding null', 'null\n'],
		['nothing', ''],
	])('reads no beats from %s', (_, lines) => {
		expect(beats_of(lines)).toBeUndefined()
	})

	it('reads one beat per JSON line', () => {
		expect(beats_of('{"text":"a","ms":1}\n{"text":"b","ms":2}\n')).toStrictEqual([
			{ text: 'a', ms: 1 },
			{ text: 'b', ms: 2 },
		])
	})
})

describe('board_compare_report.compared', () => {
	it('finds no divergence between the same beats', async () => {
		const beats = [{ text: 'ab', ms: 10 }]

		expect(await compared(beats, beats, SIZE, 'strict')).toBeUndefined()
	})

	it('reports the moment and the cells where the screens differ', async () => {
		const divergence = await compared(
			[{ text: 'ab', ms: 10 }],
			[{ text: 'ax', ms: 10 }],
			SIZE,
			'strict',
		)

		expect(report(divergence)).toContain('diverged at 0 ms: 1 differences')
	})
})

describe('board_compare_report.report', () => {
	it('prints 0 differences for a match', () => {
		expect(report(undefined)).toBe('board:compare — 0 differences\n')
	})
})
