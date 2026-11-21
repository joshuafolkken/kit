import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related_record, type RunInput } from './test-related-record'
import { test_related_red } from './test-related-red'
import { test_related_run } from './test-related-run'
import { test_unit_guard } from './test-unit-guard'

const { FAILED_TEST } = vi.hoisted(() => ({ FAILED_TEST: 'scripts/source.test.ts' }))

vi.mock('./test-related-claim', () => ({
	test_related_claim: {
		with_unit_claim: vi.fn(async (_files, run: () => Promise<number>) => await run()),
	},
}))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { run_guarded_vitest: vi.fn(async () => 0) },
}))
vi.mock('./related-heavy-tests', () => ({
	related_heavy_tests: { exclude_flags: vi.fn(() => []) },
}))
vi.mock('./test-related-red', () => ({
	test_related_red: { failed_of: vi.fn(() => [FAILED_TEST]) },
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

// joshuafolkken/kit#7965: how the run ended reaches its recorded row — a red one with its failed files.

const SOURCE = 'scripts/source.ts'
const RED_EXIT = 1

const INPUT: RunInput = {
	root: '/fixture',
	changed: [SOURCE],
	synced: [],
	since_map: [],
	scope: { mode: 'related', files: [`/fixture/${SOURCE}`], reason: 'fixture' },
}

function recorded(): unknown {
	return vi.mocked(test_related_record.record_run).mock.calls[0]?.[1]
}

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

describe('test_related_run.run_and_record — the outcome it records', () => {
	it('records a green run with its exit code and reads no failed files', async () => {
		await test_related_run.run_and_record(INPUT, [])

		expect(recorded()).toMatchObject({ exit_code: 0 })
		expect(recorded()).not.toHaveProperty('failed')
		expect(test_related_red.failed_of).not.toHaveBeenCalled()
	})

	it('records a red run with its exit code and the files its log named', async () => {
		vi.mocked(test_unit_guard.run_guarded_vitest).mockResolvedValueOnce(RED_EXIT)

		expect(await test_related_run.run_and_record(INPUT, [])).toBe(RED_EXIT)
		expect(recorded()).toMatchObject({ exit_code: RED_EXIT, failed: [FAILED_TEST] })
		expect(test_related_red.failed_of).toHaveBeenCalledWith(INPUT.scope, expect.any(Number))
	})
})
