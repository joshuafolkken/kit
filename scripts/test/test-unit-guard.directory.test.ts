import path from 'node:path'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { DIRECT_LAUNCH_FILE } from '#tools/test/local-bin-mock'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_recording } from './test-read-recording'
import { test_unit_guard } from './test-unit-guard'
import { unit_share_fixture } from './unit-share-fixture'
import { vitest_failure_summary } from './vitest-failure-summary'

vi.mock('execa', () => ({ execa: vi.fn() }))
// The `pnpm exec` list is asserted here; where vitest resolves to is `local-bin.test.ts`.
vi.mock('#scripts/build/local-bin', async () => await import('#tools/test/local-bin-mock'))
vi.mock('#scripts/git/changed-file-scope', () => ({
	changed_file_scope: { repository_root_or_cwd: vi.fn() },
}))
// Mocked for the reason `test-unit-guard.test.ts` gives: the real one writes this checkout's map.
vi.mock('./test-read-recording', () => ({ test_read_recording: { with_read_recording: vi.fn() } }))
// Mocked because the real one writes this checkout's unit log; what it writes and prints is
// `vitest-failure-summary.test.ts`. Here it is the hand-off of the run's output.
vi.mock('./vitest-failure-summary', () => ({ vitest_failure_summary: { report: vi.fn() } }))

type ExecaResult = Awaited<ReturnType<typeof execa>>

const mocked_execa = vi.mocked(execa)
const ROOT = path.resolve('/repo')
const CHECKOUT = path.resolve('/checkout')
const RELATED = ['related', 'scripts/git/change-base.ts', '--run']
const VITEST_OUTPUT = ' FAIL  scripts/git/change-base.test.ts > fails'
const ISOLATED = test_unit_guard.isolated_unit_environment()

beforeEach(() => {
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
	// joshuafolkken/kit#7259: launched without pnpm's wrapper, vitest still gets exactly the isolated
	// environment it got through `pnpm exec`.
	it('starts vitest in the given checkout rather than in this process’s directory', async () => {
		await expect(test_unit_guard.run_vitest_in(CHECKOUT, RELATED)).resolves.toBe(0)
		expect(mocked_execa).toHaveBeenCalledWith(
			DIRECT_LAUNCH_FILE,
			['exec', 'vitest', ...RELATED],
			expect.objectContaining({ cwd: CHECKOUT, env: ISOLATED, extendEnv: false }),
		)
	})

	// joshuafolkken/kit#4869: the output is shown as it runs and also kept, so a failed run can end
	// with its failed tests and the log's path.
	it('shows the output as it runs and hands it to the failure summary', async () => {
		mocked_execa.mockResolvedValue({ exitCode: 1, all: VITEST_OUTPUT } as unknown as ExecaResult)

		await expect(test_unit_guard.run_vitest_in(CHECKOUT, RELATED)).resolves.toBe(1)
		expect(mocked_execa).toHaveBeenCalledWith(
			DIRECT_LAUNCH_FILE,
			['exec', 'vitest', ...RELATED],
			expect.objectContaining({
				stdout: ['inherit', 'pipe'],
				stderr: ['inherit', 'pipe'],
				all: true,
			}),
		)
		expect(vitest_failure_summary.report).toHaveBeenCalledWith(RELATED, VITEST_OUTPUT, 1)
	})

	it('keeps every other run in this process’s directory', async () => {
		await test_unit_guard.run_guarded_vitest(process.cwd(), RELATED)

		expect(mocked_execa).toHaveBeenCalledWith(
			DIRECT_LAUNCH_FILE,
			['exec', 'vitest', ...RELATED],
			expect.objectContaining({ cwd: process.cwd() }),
		)
	})
})
