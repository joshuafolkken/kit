import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { self_run_guard_fixture } from './self-run-guard-fixture'
import { did_refuse_self_run } from './self-sync-refusal'

const { PACKAGE_NAME, REFUSAL_PREFIX } = self_run_guard_fixture
const CONSUMER_NAME = 'consumer-project'

beforeEach(() => {
	process.exitCode = undefined
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	process.exitCode = undefined
})

describe('did_refuse_self_run', () => {
	it('reports the refusal and exits non-zero inside the package’s own repository', () => {
		const directory = self_run_guard_fixture.make_project(PACKAGE_NAME)

		expect(did_refuse_self_run(directory, directory)).toBe(true)
		expect(process.exitCode).toBe(1)
	})

	it('prints what was detected and what to do instead', () => {
		const directory = self_run_guard_fixture.make_project(PACKAGE_NAME)

		did_refuse_self_run(directory, directory)

		const message = vi.mocked(console.error).mock.calls.flat().join('\n')

		expect(message).toContain(REFUSAL_PREFIX)
		expect(message).toContain('Run this command from a consumer project instead.')
	})

	// The other half of the guard: a real consumer keeps running, and the exit code is left alone so
	// a command that succeeds is not reported as a failure.
	it('leaves a consumer project untouched', () => {
		const package_directory = self_run_guard_fixture.make_project(PACKAGE_NAME)
		const project_root = self_run_guard_fixture.make_project(CONSUMER_NAME)

		expect(did_refuse_self_run(package_directory, project_root)).toBe(false)
		expect(process.exitCode).toBeUndefined()
		expect(console.error).not.toHaveBeenCalled()
	})
})
