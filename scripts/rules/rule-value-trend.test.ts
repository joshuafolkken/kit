import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import type { RuleState } from './rule-value'
import { rule_value_cli } from './rule-value-cli'
import { rule_value_runs, type RunSummary } from './rule-value-runs'
import { rule_value_trend } from './rule-value-trend'

const MONDAY_MS = Date.parse('2026-11-09T00:00:00Z')
const PREVIOUS_MONDAY_MS = Date.parse('2026-11-02T00:00:00Z')
const NOW_MS = Date.parse('2026-11-12T00:00:00Z')
const TEMPORARY_PREFIX = 'rule-value-trend-'
const make_directory = temporary_directory()
const [FIRST_RULE, SECOND_RULE] = delivered_rules.MEASURED_RULES
const FIRST_ID = FIRST_RULE?.id ?? ''
const SECOND_ID = SECOND_RULE?.id ?? ''
const FIRST_GUARD = time_transcript_line.guard_from_refusal(FIRST_RULE?.reason ?? '')

const REFUSED: RuleState = {
	is_kept: false,
	is_reached: true,
	is_triggered: true,
	is_refused: true,
	is_rewritten: false,
}

const REACHED: RuleState = { ...REFUSED, is_triggered: false, is_refused: false, is_kept: true }

function fake_file(owner: string, modified_ms: number): SessionFile {
	return { owner, modified_ms } as unknown as SessionFile
}

function owner_of(file: SessionFile): string {
	return (file as unknown as { owner: string }).owner
}

// Each run's summary, by owner, in place of reading its transcripts.
const SUMMARIES = new Map<string, RunSummary>([
	['refused', { is_read: true, states: [[FIRST_ID, REFUSED]], shapes: [], rephrased: [] }],
	[
		'rephrased',
		{ is_read: true, states: [[FIRST_ID, REACHED]], shapes: [], rephrased: [[FIRST_GUARD, 1]] },
	],
	['reached', { is_read: true, states: [[FIRST_ID, REACHED]], shapes: [], rephrased: [] }],
])

// Run `rule:value` over the listed files at `NOW_MS`, returning what it printed and its exit code.
function weekly(argv: ReadonlyArray<string>, files: ReadonlyArray<SessionFile>): [string, number] {
	const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
	vi.useFakeTimers({ now: NOW_MS })
	vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue([...files])
	vi.spyOn(cost_transcript, 'owning_session_id').mockImplementation(owner_of)
	vi.spyOn(rule_value_runs, 'summaries_of').mockImplementation((runs) =>
		[...runs.keys()].map((owner) => SUMMARIES.get(owner) ?? rule_value_runs.summarize([])),
	)

	const code = rule_value_cli.run_rule_value(argv, make_directory(TEMPORARY_PREFIX))

	return [stdout.mock.calls.map(([text]) => String(text)).join(''), code]
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('rule_value_trend.week_start — weeks open on Monday 00:00 UTC', () => {
	it.each([
		['2026-11-09T00:00:00.000Z', MONDAY_MS],
		['2026-11-08T23:59:59.999Z', PREVIOUS_MONDAY_MS],
		['2026-11-15T23:59:59.999Z', MONDAY_MS],
		['2026-11-02T00:00:00.000Z', PREVIOUS_MONDAY_MS],
	])('puts %s in the week opening at %i', (time: string, expected: number) => {
		expect(rule_value_trend.week_start(Date.parse(time))).toBe(expected)
	})
})

describe('rule_value_trend.by_week — a run is never split', () => {
	it('counts a run in the week of its newest file, oldest week first', () => {
		const spanning = [fake_file('a', MONDAY_MS - 1), fake_file('a', MONDAY_MS)]
		const older = [fake_file('b', MONDAY_MS - 1)]
		const weeks = rule_value_trend.by_week(
			new Map([
				['a', spanning],
				['b', older],
			]),
		)

		expect(weeks.map(([week, runs]) => [week, [...runs.keys()]])).toStrictEqual([
			[PREVIOUS_MONDAY_MS, ['b']],
			[MONDAY_MS, ['a']],
		])
	})
})

describe('rule_value_cli.run_rule_value — --weekly prints each named rule week by week', () => {
	const files = [
		fake_file('refused', MONDAY_MS - 1),
		fake_file('rephrased', MONDAY_MS),
		fake_file('reached', NOW_MS - 1),
	]

	it('lines up reached / refused / rephrased per week for every named rule', () => {
		expect(weekly(['--weekly', FIRST_ID, SECOND_ID], files)).toStrictEqual([
			[
				FIRST_ID,
				'  2026-11-02  reached 1  refused 1  rephrased 0',
				'  2026-11-09  reached 2  refused 0  rephrased 1',
				'',
				SECOND_ID,
				'  2026-11-02  reached 0  refused 0  rephrased 0',
				'  2026-11-09  reached 0  refused 0  rephrased 0',
				'',
			].join('\n'),
			0,
		])
	})

	it('leaves out the weeks before --period', () => {
		const [text] = weekly(['--weekly', FIRST_ID, '--period', '1'], files)

		expect(text).toBe(`${FIRST_ID}\n  2026-11-09  reached 1  refused 0  rephrased 0\n`)
	})

	it('prints no measurement targets when no run was read', () => {
		expect(weekly(['--weekly', FIRST_ID], [])).toStrictEqual([`${rule_value_cli.NO_TARGETS}\n`, 0])
	})
})

describe('rule_value_cli.run_rule_value — --weekly refuses what it cannot read', () => {
	it.each([[['--weekly']], [['--weekly', '--fresh']], [['--weekly', 'no-such-rule']]])(
		'refuses %j with the weekly usage line',
		(argv: Array<string>) => {
			const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

			expect(rule_value_cli.run_rule_value(argv, make_directory(TEMPORARY_PREFIX))).toBe(1)
			expect(stderr).toHaveBeenCalledExactlyOnceWith(`${rule_value_trend.WEEKLY_USAGE}\n`)
		},
	)

	it('refuses a --period that is not a positive number with the period usage line', () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
		const argv = ['--weekly', FIRST_ID, '--period', '0']

		expect(rule_value_cli.run_rule_value(argv, make_directory(TEMPORARY_PREFIX))).toBe(1)
		expect(stderr).toHaveBeenCalledExactlyOnceWith(`${rule_value_cli.PERIOD_USAGE}\n`)
	})
})
