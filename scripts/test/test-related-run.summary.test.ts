import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunInput } from './test-related-record'
import { test_related_run } from './test-related-run'

const { TEST_FILES } = vi.hoisted(() => ({ TEST_FILES: 12 }))

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
vi.mock('./test-related-record', () => ({
	test_related_record: {
		with_test_count: vi.fn(async (run: () => Promise<number>) => ({
			exit_code: await run(),
			test_files: TEST_FILES,
		})),
		record_run: vi.fn(),
	},
}))

// joshuafolkken/kit#7735: every run closes on the selected count and the widest changed file.

const SOURCE = 'scripts/source.ts'
const REACHED = 9

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_related_run.run_and_record — the closing line', () => {
	it('writes the selected count and the widest changed file once the run ends', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const input: RunInput = {
			root: '/fixture',
			changed: [SOURCE],
			synced: [],
			since_map: [],
			scope: { mode: 'related', files: [`/fixture/${SOURCE}`], reason: 'fixture' },
			reach: [{ file: SOURCE, count: REACHED }],
		}

		await test_related_run.run_and_record(input, [])

		expect(write).toHaveBeenCalledWith(
			`josh test:related: ${String(TEST_FILES)} test file(s) selected, widest ${SOURCE} (reaches ${String(REACHED)})\n`,
		)
	})
})
