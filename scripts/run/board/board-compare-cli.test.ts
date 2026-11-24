import { describe, expect, it } from 'vitest'
import { board_compare_cli, type ComparePorts } from './board-compare-cli'
import type { Beat } from './run-board-reveal-blocks'

const { beats_of, board_argv, options_of, run } = board_compare_cli
const ARGV = ['demo.mjs', '--theme', 'bttf', '--columns', '8', '--rows', '2']
const DIVERGED_EXIT_CODE = 1
const FAILURE_EXIT_CODE = 2

function ports_of(
	demo: Array<Beat>,
	board: Array<Beat> | undefined,
): ComparePorts & { out: Array<string> } {
	const out: Array<string> = []

	return {
		out,
		demo_beats: async () => demo,
		board_beats: async () => board,
		write: (text) => {
			out.push(text)
		},
	}
}

describe('board_compare_cli.run', () => {
	it('prints 0 differences and exits 0 on a match', async () => {
		const ports = ports_of([{ text: 'ab', ms: 0 }], [{ text: 'ab', ms: 0 }])

		expect(await run(ARGV, ports)).toBe(0)
		expect(ports.out.join('')).toBe('board:compare — 0 differences\n')
	})

	it('prints the first moment, the count and the cells, and exits 1 on a divergence', async () => {
		const ports = ports_of([{ text: 'ab', ms: 0 }], [{ text: 'ax', ms: 0 }])

		expect(await run(ARGV, ports)).toBe(DIVERGED_EXIT_CODE)
		expect(ports.out.join('')).toBe(
			[
				'board:compare — diverged at 0 ms: 1 differences',
				"  row 0 col 1: expected 'b' fg 0:-1 bg 0:-1 style - · actual 'x' fg 0:-1 bg 0:-1 style -",
				'',
			].join('\n'),
		)
	})

	it.each([
		['no demo', ['--theme', 'bttf']],
		['no theme', ['demo.mjs']],
		['a count that is none', ['demo.mjs', '--theme', 'bttf', '--steps', 'many']],
		['an unknown flag', ['demo.mjs', '--theme', 'bttf', '--fast']],
	])('prints the usage and exits 2 for %s', async (_, argv) => {
		const ports = ports_of([], [])

		expect(await run(argv, ports)).toBe(FAILURE_EXIT_CODE)
		expect(ports.out.join('')).toMatch(/^Usage: josh board:compare/u)
	})
})

describe('board_compare_cli.run refusals', () => {
	it('prints the usage and exits 2 where the replay refuses the arguments', async () => {
		expect(await run(ARGV, ports_of([], undefined))).toBe(FAILURE_EXIT_CODE)
	})

	it.each([
		['the demo', 'demo_beats'],
		['the replay', 'board_beats'],
	] as const)('prints the error and exits 2 where %s fails', async (_, port) => {
		const ports = {
			...ports_of([], []),
			[port]: async () => {
				throw new Error('Command failed: exit 1')
			},
		}

		expect(await run(ARGV, ports)).toBe(FAILURE_EXIT_CODE)
		expect(ports.out.join('')).toBe('board:compare — Command failed: exit 1\n')
	})

	it('names the beats form and exits 2 where the demo writes no beat lines', async () => {
		const ports = { ...ports_of([], []), demo_beats: async () => undefined }

		expect(await run(ARGV, ports)).toBe(FAILURE_EXIT_CODE)
		expect(ports.out.join('')).toMatch(/needs the DEMO_BEATS=1 form/u)
	})
})

describe('board_compare_cli arguments', () => {
	it('replays the board on the same seed and a fixed clock start, as many redraws as the demo steps, on the same screen', () => {
		const options = options_of([
			'demo.mjs',
			'--theme',
			'bttf',
			'--seed',
			'3',
			'--steps',
			'9',
			'--loose',
		])

		expect(options?.mode).toBe('loose')
		expect(options && board_argv(options)).toStrictEqual([
			'--theme',
			'bttf',
			'--seed',
			'3',
			'--at',
			'0',
			'--ticks',
			'9',
			'--columns',
			'120',
			'--rows',
			'40',
		])
	})
})

describe('board_compare_cli.beats_of', () => {
	it.each([
		['raw terminal bytes', '\u{1B}[?1049h\u{1B}[2J'],
		['a line without a wait', '{"text":"a"}\n'],
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
