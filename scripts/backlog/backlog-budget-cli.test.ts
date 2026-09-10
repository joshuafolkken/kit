import { describe, expect, it } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_budget_cli } from './backlog-budget-cli'

const STARTED = '2026-09-09T11:00:00Z'
const ACTIVE = '2026-09-09T11:45:00Z'
const UNPARSEABLE_TIME = 'yesterday'
const NOW_MS = Date.parse('2026-09-09T12:00:00Z')
const IDLE_MINUTES = 30
const MAX_ISSUES = 5
const MERGED = 2
// `--active` is part of every readable invocation now that the idle watch is on by default
// (joshuafolkken/kit#1676): the watch cannot be measured without it, and only `--idle 0` excuses it.
const REQUIRED = ['--answer', 'candidates', '--started', STARTED, '--active', ACTIVE]
const WITHOUT_ACTIVE = ['--answer', 'candidates', '--started', STARTED]

function build(argv: ReadonlyArray<string>): ReturnType<typeof backlog_budget_cli.build_input> {
	const values = backlog_budget_cli.read_arguments(argv)

	return values === undefined ? undefined : backlog_budget_cli.build_input(values, NOW_MS)
}

describe('backlog_budget_cli.build_input — what a readable invocation carries', () => {
	it('defaults the idle watch on and the maximum to unlimited', () => {
		const input = build(REQUIRED)

		expect(input).toEqual({
			answer: 'candidates',
			started_at_ms: Date.parse(STARTED),
			active_at_ms: Date.parse(ACTIVE),
			now_ms: NOW_MS,
			merged: 0,
			running: 0,
			max_issues: undefined,
			idle_budget_ms: backlog_budget.DEFAULT_IDLE_MS,
		})
	})

	it('reads the idle watch in minutes and the maximum as a count', () => {
		const input = build([
			...REQUIRED,
			'--idle',
			String(IDLE_MINUTES),
			'--max',
			String(MAX_ISSUES),
			'--merged',
			String(MERGED),
		])

		expect(input?.idle_budget_ms).toBe(IDLE_MINUTES * backlog_budget.MS_PER_MINUTE)
		expect(input?.max_issues).toBe(MAX_ISSUES)
		expect(input?.merged).toBe(MERGED)
	})

	it('takes --active as the moment the run last had work', () => {
		expect(build(REQUIRED)?.active_at_ms).toBe(Date.parse(ACTIVE))
	})
})

describe('backlog_budget_cli.build_input — `--idle 0` is how the watch is turned off', () => {
	it('turns the watch off rather than expiring it instantly', () => {
		expect(build([...REQUIRED, '--idle', '0'])?.idle_budget_ms).toBeUndefined()
	})

	it('needs no --active once the watch is off', () => {
		expect(build([...WITHOUT_ACTIVE, '--idle', '0'])?.idle_budget_ms).toBeUndefined()
	})
})

describe('backlog_budget_cli.build_input — an unreadable invocation is refused, never defaulted', () => {
	it.each([
		['a missing answer', ['--started', STARTED, '--active', ACTIVE]],
		['an unrecognized answer', ['--answer', 'maybe', '--started', STARTED, '--active', ACTIVE]],
		['a missing start', ['--answer', 'candidates', '--active', ACTIVE]],
		[
			'an unparseable start',
			['--answer', 'candidates', '--started', UNPARSEABLE_TIME, '--active', ACTIVE],
		],
		['an unparseable active moment', [...WITHOUT_ACTIVE, '--active', UNPARSEABLE_TIME]],
		['a non-numeric idle budget', [...REQUIRED, '--idle', 'half-an-hour']],
		['a negative maximum', [...REQUIRED, '--max', '-1']],
		['a fractional merged count', [...REQUIRED, '--merged', '1.5']],
		['an empty count from an unset shell variable', [...REQUIRED, '--max', '']],
		['a whitespace-only count', [...REQUIRED, '--merged', ' ']],
		['a hexadecimal count', [...REQUIRED, '--max', '0x10']],
		['a non-numeric running count', [...REQUIRED, '--running', 'two']],
		[
			'an idle watch with nothing to measure it from',
			[...WITHOUT_ACTIVE, '--idle', String(IDLE_MINUTES)],
		],
		['the default watch with nothing to measure it from', WITHOUT_ACTIVE],
	])('refuses %s', (_name, argv) => {
		expect(build(argv)).toBeUndefined()
	})
})

describe('backlog_budget_cli.run', () => {
	it('refuses an unknown flag rather than answering around it', () => {
		expect(backlog_budget_cli.run([...REQUIRED, '--nope'], NOW_MS)).toBe(1)
	})

	it('refuses a positional argument', () => {
		expect(backlog_budget_cli.run([...REQUIRED, 'candidates'], NOW_MS)).toBe(1)
	})

	it('answers a readable invocation', () => {
		expect(backlog_budget_cli.run(REQUIRED, NOW_MS)).toBe(backlog_budget_cli.SUCCESS_EXIT_CODE)
	})
})
