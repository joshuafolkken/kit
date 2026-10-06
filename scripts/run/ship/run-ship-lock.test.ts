import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: run_mock,
		is_process_failed: (result: { exit_code: number | undefined }): boolean =>
			result.exit_code !== 0,
	},
}))

const { run_ship_lock } = await import('./run-ship-lock')

// joshuafolkken/kit#3307: a drifted lock file was rewritten by the pre-push hook's install, leaving the
// tree dirty so the hook re-ran the whole unit suite and timed the push out. The ship asks first.

const WITH_LOCK = mkdtempSync(path.join(tmpdir(), 'josh-ship-lock-'))
const WITHOUT_LOCK = mkdtempSync(path.join(tmpdir(), 'josh-ship-no-lock-'))

writeFileSync(path.join(WITH_LOCK, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

beforeEach(() => {
	run_mock.mockReset().mockResolvedValue({ output: '', exit_code: 0, elapsed_ms: 1 })
})

afterAll(() => {
	rmSync(WITH_LOCK, { force: true, recursive: true })
	rmSync(WITHOUT_LOCK, { force: true, recursive: true })
})

describe('run_ship_lock.lock_problems', () => {
	it('asks the frozen lock-only install in the project directory, and passes a matching lock', async () => {
		expect(await run_ship_lock.lock_problems(WITH_LOCK)).toStrictEqual([])
		expect(run_mock).toHaveBeenCalledWith(
			run_ship_lock.LOCK_CHECK_ARGUMENTS,
			expect.objectContaining({ cwd: WITH_LOCK }),
		)
	})

	it('reports a drifted lock with its reason and the fix', async () => {
		run_mock.mockResolvedValue({ output: 'pnpmfileChecksum mismatch', exit_code: 1, elapsed_ms: 1 })

		const problems = await run_ship_lock.lock_problems(WITH_LOCK)

		expect(problems).toStrictEqual([
			`${run_ship_lock.LOCK_DRIFT} pnpm said: pnpmfileChecksum mismatch`,
		])
		expect(problems[0]).toContain('run `pnpm install` and commit pnpm-lock.yaml')
	})

	it("carries pnpm's first line without its color codes, so a refusal other than drift is told apart", async () => {
		run_mock.mockResolvedValue({
			output: '\n  Error: \u{1B}[31mERR_PNPM_UNSUPPORTED_ENGINE\u{1B}[0m\n\n  details',
			exit_code: 1,
			elapsed_ms: 1,
		})

		expect(await run_ship_lock.lock_problems(WITH_LOCK)).toStrictEqual([
			`${run_ship_lock.LOCK_DRIFT} pnpm said: Error: ERR_PNPM_UNSUPPORTED_ENGINE`,
		])
	})

	it('reports the drift alone when pnpm printed nothing', async () => {
		run_mock.mockResolvedValue({ output: '', exit_code: undefined, elapsed_ms: 1 })

		expect(await run_ship_lock.lock_problems(WITH_LOCK)).toStrictEqual([run_ship_lock.LOCK_DRIFT])
	})

	it('asks nothing in a project with no lock file', async () => {
		expect(await run_ship_lock.lock_problems(WITHOUT_LOCK)).toStrictEqual([])
		expect(run_mock).not.toHaveBeenCalled()
	})
})
