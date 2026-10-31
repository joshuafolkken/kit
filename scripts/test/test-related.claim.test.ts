import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_related_claim } from './test-related-claim'
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
vi.mock(import('#scripts/gate/since-green'), async (import_original) => {
	const { since_green: real } = await import_original()
	const no_record = { fallback: real.FALLBACK.NO_RECORD }

	return { since_green: { ...real, read_verdict: vi.fn(async () => no_record) } }
})
// What a claim weighs for the files it is handed is `test-related-claim.test.ts`.
vi.mock('./test-related-claim', () => ({ test_related_claim: { with_unit_claim: vi.fn() } }))

const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const ABSOLUTE_SOURCE = path.join(REPOSITORY_ROOT, CHANGED_SOURCE)

const mocked_claim = vi.mocked(test_related_claim.with_unit_claim)

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED_SOURCE])
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.run_guarded_vitest).mockResolvedValue(0)
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(undefined)
	mocked_claim.mockImplementation(async (_files, run) => await run())
})

// joshuafolkken/kit#5135: the claim is taken once the scope is known, where the command entry
// claimed the whole width before it was.
describe('test_related.run_related_tests — what its vitest pass claims for', () => {
	it('claims a narrowed scope for its files, starting vitest inside the claim', async () => {
		mocked_claim.mockImplementation(async (_files, run) => {
			expect(test_unit_guard.run_guarded_vitest).not.toHaveBeenCalled()

			return await run()
		})

		await test_related.run_related_tests([])

		expect(mocked_claim).toHaveBeenCalledWith([ABSOLUTE_SOURCE], expect.any(Function))
		expect(test_unit_guard.run_guarded_vitest).toHaveBeenCalledOnce()
	})

	it('claims the whole suite as no files', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockRejectedValue(new Error('not a git repository'))

		await test_related.run_related_tests([])

		expect(mocked_claim).toHaveBeenCalledWith(undefined, expect.any(Function))
	})
})
