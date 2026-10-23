import { project_checks } from '#scripts/gate/project-checks'
import type { ChangedFileScope } from '#scripts/git/changed-file-scope'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { structural_checks } from './structural-checks'

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: vi.fn(),
		is_process_failed: (result: { exit_code: number | undefined }): boolean =>
			result.exit_code !== 0,
	},
}))
vi.mock('#scripts/gate/project-checks', () => ({
	project_checks: { is_kit_repository: vi.fn() },
}))

const run_mock = vi.mocked(buffered_process.run_buffered_process)
const is_kit_mock = vi.mocked(project_checks.is_kit_repository)

const ROOT = '/repository'
const FAILED = 1
const REASON = 'test scope'
const SOURCE_SCOPE: ChangedFileScope = {
	mode: 'related',
	files: [`${ROOT}/scripts/a.ts`],
	reason: REASON,
}
const DOCUMENT_SCOPE: ChangedFileScope = {
	mode: 'related',
	files: [`${ROOT}/docs/a.md`],
	reason: REASON,
}
const WHOLE_SCOPE: ChangedFileScope = { mode: 'all', files: [], reason: REASON }
const GUARDS = [
	...structural_checks.GUARD_TEST_COMMAND,
	...structural_checks.STRUCTURAL_GUARD_TARGETS,
].join(' ')
const PASSED: BufferedProcessResult = { output: '', exit_code: 0, elapsed_ms: 1 }

function answer(failures: ReadonlyMap<string, string>): void {
	run_mock.mockImplementation(async (list) => {
		const output = failures.get(list.join(' '))

		return output === undefined ? PASSED : { output, exit_code: FAILED, elapsed_ms: 1 }
	})
}

function failure_report(command: string, output: string): string {
	return `✗ ${command} — exit code 1\n${output}`
}

function commands(): Array<string> {
	return run_mock.mock.calls.map(([list]) => list.join(' '))
}

function written_output(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

beforeEach(() => {
	run_mock.mockReset()
	is_kit_mock.mockReturnValue(true)
	answer(new Map())
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

describe('structural_checks.run_structural — when it runs', () => {
	it('runs the guard tests in the root when a source changed', async () => {
		await expect(structural_checks.run_structural(SOURCE_SCOPE, ROOT)).resolves.toBe(0)
		expect(commands()).toStrictEqual([GUARDS])
		expect(run_mock.mock.calls[0]?.[1]).toStrictEqual({ cwd: ROOT })
	})

	it('runs them over a whole-tree fallback', async () => {
		await structural_checks.run_structural(WHOLE_SCOPE, ROOT)

		expect(commands()).toStrictEqual([GUARDS])
	})

	it('runs nothing when no source changed', async () => {
		await expect(structural_checks.run_structural(DOCUMENT_SCOPE, ROOT)).resolves.toBe(0)
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs nothing in a consumer project', async () => {
		is_kit_mock.mockReturnValue(false)

		await expect(structural_checks.run_structural(SOURCE_SCOPE, ROOT)).resolves.toBe(0)
		expect(run_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4643: each of the guards lane #4621 first met in `test:related`.
describe('structural_checks.run_structural — what it reports', () => {
	it.each([
		['a bare Issue citation', 'session-cite-scan.test.ts > assembles no bare `#${…}`'],
		['a source with no colocated test', 'untested-sources.test.ts > has a test named after'],
		['a gh spawn outside gh api', 'gh-subcommand-guard.test.ts > spawns gh only through api'],
	])('reports %s from the guard tests', async (_name, failure) => {
		answer(new Map([[GUARDS, failure]]))

		await expect(structural_checks.run_structural(SOURCE_SCOPE, ROOT)).resolves.toBe(FAILED)
		expect(written_output()).toContain(failure_report(GUARDS, failure))
	})
})

describe('structural_checks.run_structural — the edges of the report', () => {
	it('prints nothing on a green run', async () => {
		await structural_checks.run_structural(SOURCE_SCOPE, ROOT)

		expect(process.stdout.write).not.toHaveBeenCalled()
	})

	it('names a check that ended with no exit code', async () => {
		run_mock.mockResolvedValue({ output: '', exit_code: undefined, elapsed_ms: 1 })

		await structural_checks.run_structural(SOURCE_SCOPE, ROOT)

		expect(written_output()).toContain('no exit code (timed out or ended by a signal)')
	})
})

describe('structural_checks — the guard targets', () => {
	it('names the cite scan, the colocated-test guard and the static gh spawn guard', () => {
		expect(structural_checks.STRUCTURAL_GUARD_TARGETS).toStrictEqual([
			'scripts/issue/session-cite-scan.test.ts',
			'tools/test/untested-sources.test.ts',
			'tools/gh/gh-subcommand-guard.test.ts',
		])
	})
})
