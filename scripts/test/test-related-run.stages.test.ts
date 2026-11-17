import { launch_timing } from '#scripts/lane/launch-timing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related_record, type RunInput } from './test-related-record'
import { test_related_run } from './test-related-run'

const { WAIT_MS } = vi.hoisted(() => ({ WAIT_MS: 1500 }))

vi.mock('./test-related-claim', () => ({
	test_related_claim: {
		with_unit_claim: vi.fn(
			async (_files, run: (wait_ms?: number) => Promise<number>) => await run(WAIT_MS),
		),
	},
}))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { run_guarded_vitest: vi.fn(async () => 0) },
}))
vi.mock('./related-heavy-tests', () => ({
	related_heavy_tests: { exclude_flags: vi.fn(() => []) },
}))
vi.mock('./test-related-record', () => ({
	test_related_record: {
		with_test_count: vi.fn(async (run: () => Promise<number>) => ({
			exit_code: await run(),
			test_files: 1,
		})),
		record_run: vi.fn(),
	},
}))

// joshuafolkken/kit#7828: the launcher's rebuild, the claim's wait and vitest reach the recorded row.

const SOURCE = 'scripts/source.ts'
const REBUILD_MS = 4200

const INPUT: RunInput = {
	root: '/fixture',
	changed: [SOURCE],
	synced: [],
	since_map: [],
	scope: { mode: 'related', files: [`/fixture/${SOURCE}`], reason: 'fixture' },
}

function recorded_stages(): unknown {
	return vi.mocked(test_related_record.record_run).mock.calls[0]?.[1].stages
}

beforeEach(() => {
	launch_timing.clear()
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

describe('test_related_run.run_and_record — the stage times it records', () => {
	it('records the rebuild time, the core wait and the vitest time', async () => {
		launch_timing.set_rebuild_ms(REBUILD_MS)

		await test_related_run.run_and_record(INPUT, [])

		expect(recorded_stages()).toStrictEqual({
			rebuild_ms: REBUILD_MS,
			core_wait_ms: WAIT_MS,
			vitest_ms: expect.any(Number),
		})
	})

	it('records no rebuild time where the launcher ran none', async () => {
		await test_related_run.run_and_record(INPUT, [])

		expect(recorded_stages()).toMatchObject({ rebuild_ms: undefined, core_wait_ms: WAIT_MS })
	})
})
