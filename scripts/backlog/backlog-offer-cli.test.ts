import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const rule_value_emit_mock = vi.hoisted(() => vi.fn())
const emit_once_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/rules/rule-value-cli', () => ({
	rule_value_cli: { emit: rule_value_emit_mock },
}))
vi.mock('#scripts/run/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit_once: emit_once_mock },
}))

const { backlog_offer_cli } = await import('./backlog-offer-cli')

const OK = 0
const FAILED = 1
const STARTED = '2026-01-01T00:00:00Z'
const BASE = ['--started', STARTED, '--active', STARTED]
const ANSWER_FLAG = '--answer'
const RUNNING = ['--running', '2']
const REPO = 'joshuafolkken/kit'
const EXCLUDE_FLAG = '--exclude'
const EXCLUDED = '1630'
const MERGED = ['--merged', '3']
const CANDIDATES = 'candidates'

interface JoshResult {
	code: number
	out: string
}

const info_lines: Array<string> = []

beforeEach(() => {
	josh_run_mock.mockReset()
	rule_value_emit_mock.mockReset()
	emit_once_mock.mockReset()
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

// Stub `backlog:next`, then `backlog:budget`, run the command, and read back the `--answer` word the
// budget call was given — the whole point of the command is that the mapping fixed by the loop table
// happens here.
async function answer_for(
	next: JoshResult,
	budget_verdict: string,
	argv: ReadonlyArray<string> = [],
): Promise<string> {
	josh_run_mock.mockReset()
	josh_run_mock.mockResolvedValueOnce(next)
	josh_run_mock.mockResolvedValueOnce({
		code: OK,
		out: JSON.stringify({ budget: budget_verdict, reason: 'budget reason', is_finish: true }),
	})

	await backlog_offer_cli.run([...BASE, ...argv])
	const [, budget_call] = josh_run_mock.mock.calls
	const budget_args = (budget_call?.[0] ?? []) as ReadonlyArray<string>

	return budget_args[budget_args.indexOf(ANSWER_FLAG) + 1] ?? ''
}

describe('backlog_offer_cli.run — the loop table maps each backlog:next answer to a budget word', () => {
	it('maps issue numbers to candidates', async () => {
		expect(await answer_for({ code: OK, out: '12\n13' }, 'run')).toBe('candidates')
	})

	it('maps stop to parked, none to exhausted, error to unreadable', async () => {
		expect(await answer_for({ code: OK, out: 'stop' }, 'stop')).toBe('parked')
		expect(await answer_for({ code: OK, out: 'none' }, 'stop')).toBe('exhausted')
		expect(await answer_for({ code: OK, out: 'error' }, 'stop')).toBe('unreadable')
	})

	it('maps wait by whether children are in flight', async () => {
		expect(await answer_for({ code: OK, out: 'wait' }, 'stop')).toBe('exhausted')
		expect(await answer_for({ code: OK, out: 'wait' }, 'watch', RUNNING)).toBe('blocked')
	})

	it('maps retry by the consecutive count', async () => {
		expect(await answer_for({ code: OK, out: 'retry' }, 'watch')).toBe('blocked')
		expect(await answer_for({ code: OK, out: 'retry' }, 'stop', ['--retries', '2'])).toBe(
			'unreadable',
		)
	})

	it('maps exit 1 to unreadable, never to the empty-backlog answer', async () => {
		const answer = await answer_for({ code: FAILED, out: '' }, 'stop')

		expect(answer).toBe('unreadable')
		expect(answer).not.toBe('exhausted')
	})
})

describe('backlog_offer_cli.run — the output the loop reads', () => {
	it('prints the budget verdict and, on run, the issues to start', async () => {
		await answer_for({ code: OK, out: '12\n13' }, 'run')

		expect(info_lines).toStrictEqual(['run', '12', '13'])
	})

	it('prints the verdict alone on a non-run answer', async () => {
		await answer_for({ code: OK, out: 'wait' }, 'watch', RUNNING)

		expect(info_lines).toStrictEqual(['watch'])
	})

	// The loop head is `rule:value`'s one call site — every valid iteration measures the delivered
	// rules so a rule that never fires appears as a printed row (joshuafolkken/kit#2271).
	it('measures the delivered rules once per iteration', async () => {
		await answer_for({ code: OK, out: '12' }, 'run')

		expect(rule_value_emit_mock).toHaveBeenCalledTimes(1)
	})

	it('fails when backlog:budget refuses the invocation', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: OK, out: 'wait' })
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: '' })

		const code = await backlog_offer_cli.run(BASE)

		expect(code).toBe(FAILED)
	})
})

// joshuafolkken/kit#2335: the loop head marks the stream at the drain — the backlog empty (`exhausted`)
// and nothing of the run's own in flight — so `run:step` fires the end-of-run retrospective before the
// idle watch. Every other verdict, and a watch that opened while children were still merging, leaves the
// stream untouched.
const DRAIN_KIND = 'drain'

describe('backlog_offer_cli.run — the drain marks the stream before the idle watch', () => {
	it('marks the stream once when the backlog drains with nothing in flight', async () => {
		await answer_for({ code: OK, out: 'none' }, 'watch')

		expect(emit_once_mock).toHaveBeenCalledWith(DRAIN_KIND, expect.any(String))
	})

	it('marks a drain when idle zero stops on an empty backlog', async () => {
		await answer_for({ code: OK, out: 'none' }, 'stop')

		expect(emit_once_mock).toHaveBeenCalledWith(DRAIN_KIND, expect.any(String))
	})

	it('does not mark the stream on a watch that opened while children were still merging', async () => {
		await answer_for({ code: OK, out: 'none' }, 'watch', RUNNING)

		expect(emit_once_mock).not.toHaveBeenCalled()
	})

	it('does not mark the stream on a blocked watch', async () => {
		await answer_for({ code: OK, out: 'wait' }, 'watch', RUNNING)

		expect(emit_once_mock).not.toHaveBeenCalled()
	})

	it('does not mark the stream when there is work to start', async () => {
		await answer_for({ code: OK, out: '12\n13' }, 'run')

		expect(emit_once_mock).not.toHaveBeenCalled()
	})
})

describe('backlog_offer_cli — the argv it builds for each underlying command', () => {
	it('forwards --exclude and --repo to backlog:next and the budget flags to backlog:budget', () => {
		const values = backlog_offer_cli.read_values([
			...BASE,
			EXCLUDE_FLAG,
			EXCLUDED,
			'--repo',
			REPO,
			...MERGED,
		])

		expect(backlog_offer_cli.next_argv(values ?? {})).toStrictEqual([
			'backlog:next',
			EXCLUDE_FLAG,
			EXCLUDED,
			'--repo',
			REPO,
		])
		expect(backlog_offer_cli.budget_argv(values ?? {}, CANDIDATES)).toStrictEqual([
			'backlog:budget',
			'--json',
			ANSWER_FLAG,
			CANDIDATES,
			...BASE,
			...MERGED,
		])
	})

	it('refuses a --running that was given but unreadable', () => {
		const values = backlog_offer_cli.read_values([...BASE, '--running', 'lots'])

		expect(backlog_offer_cli.counts_of(values ?? {})).toBeUndefined()
	})
})
