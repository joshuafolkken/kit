import { josh_command } from '#scripts/josh/josh-run'
import { rule_value_cache } from '#scripts/rules/rule-value-cache'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_startup } from '#scripts/run/startup/run-startup'
import type { StartupEntry } from '#scripts/run/startup/run-startup-schema'
import { run_startup_store } from '#scripts/run/startup/run-startup-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_next_shared } from './backlog-next-shared'
import { backlog_offer_cli } from './backlog-offer-cli'

const rows: Array<StartupEntry> = []
const BASE = ['--started', '2026-11-13T00:00:00Z', '--running', '1']
const CASES = [
	['12', 'run', ['done', 'done', 'done']],
	['wait', 'watch', ['waiting', 'waiting', 'waiting']],
	['wait', 'stop', ['waiting', 'done', 'waiting']],
	['stop', 'watch', ['waiting', 'waiting', 'waiting']],
	['triage', 'triage', ['waiting', 'waiting', 'waiting']],
	['retry', 'watch', ['failed', 'waiting', 'failed']],
	['error', 'watch', ['failed', 'waiting', 'failed']],
	['none', 'stop', ['done', 'done', 'done']],
] as const

beforeEach(() => {
	rows.length = 0
	vi.spyOn(run_startup_store, 'record').mockImplementation(async (row) => {
		rows.push(row)
	})
	vi.spyOn(rule_value_cache, 'emit').mockImplementation(() => undefined)
	vi.spyOn(run_event_stream_emit, 'emit_once').mockResolvedValue(false)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('backlog offer startup outcomes', () => {
	it.each(CASES)(
		'records %s/%s without changing the command result',
		async (out, budget, [next, condition, offer]) => {
			vi.spyOn(backlog_next_shared, 'read').mockResolvedValue({ code: 0, out })
			vi.spyOn(josh_command, 'josh_run').mockResolvedValue({
				code: 0,
				out: JSON.stringify({ budget, reason: 'fixture', is_finish: budget === 'stop' }),
			})
			const code = await run_startup.within(
				{ run: 'run', attempt: 'offer-attempt' },
				async () => await backlog_offer_cli.run(BASE),
			)

			expect(code).toBe(0)
			expect(rows.filter((row) => row.edge === 'start').map((row) => row.phase)).toEqual([
				'offer',
				'candidates',
				'conditions',
			])
			expect(
				rows.filter((row) => row.edge !== 'start').map((row) => [row.phase, row.edge]),
			).toEqual([
				['candidates', next],
				['conditions', condition],
				['offer', offer],
			])
			expect(backlog_next_shared.read).toHaveBeenCalledOnce()
			expect(josh_command.josh_run).toHaveBeenCalledOnce()
		},
	)
})

describe('backlog offer startup failures', () => {
	it.each([
		{ code: 1, out: '' },
		{ code: 0, out: 'invalid JSON' },
	])('records an unreadable budget as failed', async (budget) => {
		vi.spyOn(backlog_next_shared, 'read').mockResolvedValue({ code: 0, out: '12' })
		vi.spyOn(josh_command, 'josh_run').mockResolvedValue(budget)

		expect(
			await run_startup.within(
				{ run: 'run', attempt: 'failed-offer' },
				async () => await backlog_offer_cli.run(BASE),
			),
		).toBe(1)
		expect(rows.filter((row) => row.edge === 'failed').map((row) => row.phase)).toEqual([
			'conditions',
			'offer',
		])
	})
})
