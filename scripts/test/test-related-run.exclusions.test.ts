import { describe, expect, it, vi } from 'vitest'
import type { RunInput } from './test-related-record'
import { test_related_run } from './test-related-run'
import { test_unit_guard } from './test-unit-guard'

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
			test_files: 1,
		})),
		record_run: vi.fn(),
	},
}))

const SOURCE = '/fixture/source.ts'
const REUSED = '/fixture/unchanged.test.ts'

describe('test_related_run — the actual runner arguments', () => {
	it('preserves exclusion values after parsing user flags', async () => {
		const input: RunInput = {
			root: '/fixture',
			changed: [],
			synced: [],
			since_map: [],
			scope: { mode: 'related', files: [SOURCE], reason: 'fixture' },
			reuse: { excluded: [REUSED], reused: 1, missed: 1, reason: 'closed', elapsed_ms: 0 },
		}

		await test_related_run.run_and_record(input, [])
		expect(test_unit_guard.run_guarded_vitest).toHaveBeenCalledWith(
			process.cwd(),
			['related', SOURCE, '--run', '--passWithNoTests', '--exclude', REUSED],
			'test:related',
			expect.any(String),
		)
	})
})
