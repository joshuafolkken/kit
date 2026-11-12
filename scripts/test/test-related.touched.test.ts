import path from 'node:path'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related } from './test-related'
import { test_related_claim } from './test-related-claim'
import { test_related_record } from './test-related-record'
import { test_related_verdict } from './test-related-verdict'
import { test_unit_guard } from './test-unit-guard'

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { is_running: vi.fn(), run_guarded_vitest: vi.fn() },
}))
// Mocked for the reason `test-related.test.ts` gives: the real one writes this checkout's record.
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
// No green record, so every case reads the whole branch change.
vi.mock(import('#scripts/gate/since-green'), async (import_original) => {
	const { since_green } = await import_original()
	const no_record = { fallback: since_green.FALLBACK.NO_RECORD }

	return { since_green: { ...since_green, read_verdict: vi.fn(async () => no_record) } }
})
vi.mock('./test-related-claim', () => ({ test_related_claim: { with_unit_claim: vi.fn() } }))

const REPOSITORY_ROOT = process.cwd()
// A real module of this tree, so its same-named test is found on disk.
const CHANGED_SOURCE = path.join('scripts', 'test', 'test-related-touched.ts')
const SAME_NAMED_TEST = path.join(
	REPOSITORY_ROOT,
	'scripts',
	'test',
	'test-related-touched.test.ts',
)
const TOUCHED = '--touched'
const SHARED_FIXTURE = 'scripts/run/cut/run-cut-cli-fixture.ts'
const FIXTURE_CONSUMER = path.join(REPOSITORY_ROOT, 'scripts/run/cut/run-cut-cli.test.ts')

const mocked_record = vi.spyOn(test_related_record, 'record_run')

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED_SOURCE])
	vi.mocked(test_unit_guard.run_guarded_vitest).mockResolvedValue(0)
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.mocked(test_related_claim.with_unit_claim).mockImplementation(
		async (_files, run) => await run(),
	)
	mocked_record.mockResolvedValue()
})

// joshuafolkken/kit#5237: the implementation loop's narrow re-check.
describe('test_related.run_related_tests — a shared fixture touched run', () => {
	it('fails early when a changed shared fixture breaks its consumer (ac-5467a9e8)', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([SHARED_FIXTURE])
		vi.mocked(test_unit_guard.run_guarded_vitest).mockResolvedValue(1)

		const code = await test_related.run_related_tests([TOUCHED])
		const [, args] = vi.mocked(test_unit_guard.run_guarded_vitest).mock.calls[0] ?? []

		expect(args).toContain(FIXTURE_CONSUMER)
		expect(code).toBe(1)
	})

	it('keeps fixture runs separate from the full-reach record (ac-9b0d3652)', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([SHARED_FIXTURE])

		await test_related.run_related_tests([TOUCHED])

		expect(mocked_record).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'touched',
				scope: expect.objectContaining({ mode: 'related' }),
			}),
			expect.anything(),
		)
		expect(scoped_green.record_if_green).toHaveBeenCalledWith(review_stamps.test_related_stamp, {
			before: undefined,
			exit_code: 0,
			target: test_related_verdict.touched_target(),
		})
	})
})

describe('test_related.run_related_tests — a --touched run', () => {
	it('runs the same-named tests of the changed module, never handing --touched to vitest', async () => {
		await test_related.run_related_tests([TOUCHED])

		const [, vitest_arguments] = vi.mocked(test_unit_guard.run_guarded_vitest).mock.calls[0] ?? []

		expect(vitest_arguments).toContain(SAME_NAMED_TEST)
		expect(vitest_arguments).not.toContain(TOUCHED)
	})

	it('reads the tree for its separate review-fix record', async () => {
		await test_related.run_related_tests([TOUCHED])

		expect(scoped_green.read_before).toHaveBeenCalledWith([])
		expect(scoped_green.record_if_green).toHaveBeenCalledWith(review_stamps.test_related_stamp, {
			before: undefined,
			exit_code: 0,
			target: test_related_verdict.touched_target(),
		})
	})

	it('records the run in the lane ledger as touched', async () => {
		await test_related.run_related_tests([TOUCHED])

		expect(mocked_record).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'touched' }),
			expect.anything(),
		)
	})

	it('reads its change from explicit file arguments when given', async () => {
		await test_related.run_related_tests([TOUCHED, CHANGED_SOURCE])

		expect(changed_paths.read_changed_paths).not.toHaveBeenCalled()
		expect(test_unit_guard.run_guarded_vitest).toHaveBeenCalledOnce()
	})
})
