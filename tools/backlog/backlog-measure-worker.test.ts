import { readFileSync } from 'node:fs'
import path from 'node:path'
import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { backlog_fixture } from '#scripts/backlog/backlog-fixture'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { backlog_measure_schema } from './backlog-measure-schema'
import { backlog_measure_worker } from './backlog-measure-worker'

const directory = temporary_directory()
const SCENARIO = backlog_measure_schema.scenario_schema.parse({
	name: 'selection',
	mode: 'cold',
	repetitions: 1,
	reads: [],
	free_lanes: 1,
})
const CANDIDATE = 901
const WAITING = [902, 903, 904, 905, 906]
const RESULT_FILE = 'result-0.json'
const WARM_RESULT_FILE = 'result-1.json'
const WARMUP_ATTEMPT = 'selection:0'

afterEach(() => vi.restoreAllMocks())
beforeEach(() => shared_cache_fixture.keep_in_memory())

test('runs production selection for one candidate and five waiting issues', async () => {
	const opted_in = [
		auto_ok_fixture.issue(CANDIDATE, CREATED_EARLIER),
		...WAITING.map((number) =>
			auto_ok_fixture.blocked_issue(number, CREATED_EARLIER, [{ number: CANDIDATE }]),
		),
	]

	backlog_fixture.stub_backlog({ opted_in })
	const result = await backlog_measure_worker.execute(SCENARIO, directory('measure-one-'), [])

	expect(result.answer.issues).toEqual([String(CANDIDATE)])
	expect(result.pass.state.in_flight).toEqual([String(CANDIDATE)])
	expect(backlog_measure_worker.execution_edge(result)).toBe('done')
})

test('keeps production candidate order and seat limit with several candidates', async () => {
	backlog_fixture.stub_backlog({
		opted_in: WAITING.map((number) => auto_ok_fixture.issue(number, CREATED_EARLIER)),
	})
	const result = await backlog_measure_worker.execute(SCENARIO, directory('measure-many-'), [])

	expect(result.answer.issues).toEqual(WAITING.map(String))
	expect(result.pass.state.in_flight).toEqual([String(WAITING[0])])
})

test('excludes in-flight issues through production selection before launching another candidate', async () => {
	backlog_fixture.stub_backlog({
		opted_in: [CANDIDATE, ...WAITING].map((number) =>
			auto_ok_fixture.issue(number, CREATED_EARLIER),
		),
	})
	const scenario = { ...SCENARIO, in_flight: [String(CANDIDATE)] }
	const result = await backlog_measure_worker.execute(scenario, directory('measure-active-'), [])

	expect(result.answer.issues).toEqual(WAITING.map(String))
	expect(result.pass.state.in_flight).toEqual([String(CANDIDATE), String(WAITING[0])])
})

test('replays selection in the worker and persists the measured result and boundaries', async () => {
	const original_http = git_gh_exec.exec_gh_api

	backlog_fixture.stub_backlog({ opted_in: [auto_ok_fixture.issue(CANDIDATE, CREATED_EARLIER)] })
	const root = directory('measure-replay-')
	const reads = [{ method: 'gh.issue_list_by_label_summary', encoding: 'listing', value: [] }]
	const scenario = backlog_measure_schema.scenario_schema.parse({ ...SCENARIO, reads })

	await backlog_measure_worker.run(scenario, root)
	expect(git_gh_exec.exec_gh_api).toBe(original_http)
	const result: unknown = JSON.parse(readFileSync(path.join(root, RESULT_FILE), 'utf8'))

	expect(result).toMatchObject({
		attempt: WARMUP_ATTEMPT,
		result: { answer: { issues: [] } },
		boundaries: expect.arrayContaining([
			expect.objectContaining({ source: 'replay', operation: reads[0]?.method }),
		]),
	})
})

test.each([true, false])(
	'persists capped=%s completeness through warm repetitions',
	async (is_capped) => {
		backlog_fixture.stub_backlog({ opted_in: [auto_ok_fixture.issue(CANDIDATE, CREATED_EARLIER)] })
		const root = directory('measure-completeness-')
		const scenario = backlog_measure_schema.scenario_schema.parse({
			...SCENARIO,
			mode: 'warm',
			reads: [
				{
					method: 'defect.measure_window',
					value: {
						days: 14,
						since: '2026-10-30',
						defects: 1,
						enhancements: 1,
						is_capped,
					},
				},
			],
		})

		await backlog_measure_worker.run(scenario, root)
		const result: unknown = JSON.parse(readFileSync(path.join(root, WARM_RESULT_FILE), 'utf8'))

		expect(result).toMatchObject({
			completeness: {
				status: is_capped ? 'degraded' : 'normal',
				normal_sample: !is_capped,
				warmup_origin: WARMUP_ATTEMPT,
			},
		})
	},
)

test('retains failed warmup reads when candidate cache skips subsequent selection', async () => {
	backlog_fixture.stub_backlog({
		opted_in: [auto_ok_fixture.issue(CANDIDATE, CREATED_EARLIER)],
		is_rate_unreadable: true,
	})
	const root = directory('measure-unread-')

	await backlog_measure_worker.run({ ...SCENARIO, mode: 'warm' }, root)
	const result: unknown = JSON.parse(readFileSync(path.join(root, WARM_RESULT_FILE), 'utf8'))

	expect(result).toMatchObject({
		completeness: {
			status: 'degraded',
			normal_sample: false,
			warmup_origin: WARMUP_ATTEMPT,
			reasons: expect.arrayContaining(['missing: defect.measure_window']),
		},
	})
})

test.each([{ memory_held: true }, { usage_limited: true }, { free_lanes: 0 }])(
	'preserves production start conditions %j',
	async (condition) => {
		backlog_fixture.stub_backlog({ opted_in: [auto_ok_fixture.issue(CANDIDATE, CREATED_EARLIER)] })
		const result = await backlog_measure_worker.execute(
			{ ...SCENARIO, ...condition },
			directory('measure-held-'),
			[],
		)

		expect(result.pass.state.in_flight).toEqual([])
		expect(backlog_measure_worker.execution_edge(result)).toBe('waiting')
	},
)

test('records a failed substitute launch as failed and retains the driver refusal', async () => {
	backlog_fixture.stub_backlog({ opted_in: [auto_ok_fixture.issue(CANDIDATE, CREATED_EARLIER)] })
	const scenario = { ...SCENARIO, outcomes: { [String(CANDIDATE)]: 'failed' as const } }
	const result = await backlog_measure_worker.execute(scenario, directory('measure-failed-'), [])

	expect(result.pass).toMatchObject({ kind: 'end', end: { reason: 'launch' } })
	expect(backlog_measure_worker.execution_edge(result)).toBe('failed')
})

test('preserves a declared future start date without attempting a tracker update', async () => {
	const issue = {
		...auto_ok_fixture.issue(CANDIDATE, CREATED_EARLIER, ['auto-ok', 'not-before']),
		body: '## 背景\n\n- 実施可能日: 2999-01-01T00:00Z\n',
	}

	backlog_fixture.stub_backlog({ opted_in: [issue] })
	const result = await backlog_measure_worker.execute(SCENARIO, directory('measure-date-'), [])

	expect(result.answer.issues).toEqual([])
	expect(backlog_measure_worker.execution_edge(result)).toBe('waiting')
})
