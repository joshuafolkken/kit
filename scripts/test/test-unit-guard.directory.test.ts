import path from 'node:path'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_recording } from './test-read-recording'
import { test_unit_guard } from './test-unit-guard'
import { unit_share_fixture } from './unit-share-fixture'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/git/changed-file-scope', () => ({
	changed_file_scope: { repository_root_or_cwd: vi.fn() },
}))
// Mocked for the reason `test-unit-guard.test.ts` gives: the real one writes this checkout's map.
vi.mock('./test-read-recording', () => ({ test_read_recording: { with_read_recording: vi.fn() } }))

type ExecaResult = Awaited<ReturnType<typeof execa>>

const mocked_execa = vi.mocked(execa)
const ROOT = path.resolve('/repo')
const CHECKOUT = path.resolve('/checkout')
const RELATED = ['related', 'scripts/git/change-base.ts', '--run']

beforeEach(() => {
	vi.clearAllMocks()
	unit_share_fixture.stub_share(undefined)
	unit_share_fixture.stub_free(undefined)
	unit_share_fixture.stub_claim(undefined)
	vi.mocked(changed_file_scope.repository_root_or_cwd).mockResolvedValue(ROOT)
	vi.mocked(test_read_recording.with_read_recording).mockImplementation(
		async (_root, _arguments, run) => await run({}),
	)
	mocked_execa.mockResolvedValue({ exitCode: 0 } as unknown as ExecaResult)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_unit_guard.run_vitest_in', () => {
	it('starts vitest in the given checkout rather than in this process’s directory', async () => {
		await expect(test_unit_guard.run_vitest_in(CHECKOUT, RELATED)).resolves.toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'vitest', ...RELATED],
			expect.objectContaining({ cwd: CHECKOUT, extendEnv: false }),
		)
	})

	it('keeps every other run in this process’s directory', async () => {
		await test_unit_guard.run_guarded_vitest(process.cwd(), RELATED)

		expect(mocked_execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'vitest', ...RELATED],
			expect.objectContaining({ cwd: process.cwd() }),
		)
	})
})
