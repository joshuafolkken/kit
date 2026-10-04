import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BranchMismatchError, git_error, OperationCancelledError } from './git-error'

const ERROR_PREFIX = '❌ Error:'
const DETAILS_PREFIX = '💡 Details:'
const TEST_ERROR_MSG = 'test error'
const STRING_ERROR_MSG = 'string error'
const INNER_CAUSE_MSG = 'inner cause'
const FAILURE_EXIT_CODE = 1

beforeEach(() => {
	process.exitCode = undefined
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error('process.exit must not be called')
	})
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
})

afterEach(() => {
	process.exitCode = undefined
	vi.restoreAllMocks()
})

describe('git_error.handle', () => {
	it('logs the error message and sets a failing exit code without exiting', () => {
		git_error.handle(new Error(TEST_ERROR_MSG))

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(ERROR_PREFIX, TEST_ERROR_MSG)
		expect(process.exitCode).toBe(FAILURE_EXIT_CODE)
		expect(process.exit).not.toHaveBeenCalled()
	})

	it('handles non-Error input', () => {
		git_error.handle(STRING_ERROR_MSG)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(ERROR_PREFIX, STRING_ERROR_MSG)
		expect(process.exitCode).toBe(FAILURE_EXIT_CODE)
	})

	it('logs cause message when error has an Error cause', () => {
		git_error.handle(new Error('outer', { cause: new Error(INNER_CAUSE_MSG) }))

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(DETAILS_PREFIX, INNER_CAUSE_MSG)
	})

	it('logs stderr from cause when cause message is empty and stderr is set', () => {
		const STDERR_OUTPUT = 'stderr output'
		const cause = Object.assign(new Error(' '.repeat(3)), { stderr: STDERR_OUTPUT })

		git_error.handle(new Error('outer', { cause }))

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(DETAILS_PREFIX, STDERR_OUTPUT)
	})
})

describe('git_error.handle — a branch mismatch', () => {
	it('renders both branch names and sets a failing exit code', () => {
		git_error.handle(
			new BranchMismatchError({ current_branch: 'feature', target_branch_name: 'main' }),
		)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith('❌ Branch mismatch detected')
		expect(vi.mocked(console.error)).toHaveBeenCalledWith('Current branch: feature')
		expect(vi.mocked(console.error)).toHaveBeenCalledWith('Expected branch: main')
		expect(vi.mocked(console.error)).not.toHaveBeenCalledWith(ERROR_PREFIX, expect.anything())
		expect(process.exitCode).toBe(FAILURE_EXIT_CODE)
	})
})

describe('git_error.handle — a cancelled operation', () => {
	it('prints the cancellation notice and sets a failing exit code', () => {
		git_error.handle(new OperationCancelledError())

		expect(vi.mocked(console.info)).toHaveBeenCalledWith('💡 Operation cancelled.')
		expect(vi.mocked(console.error)).not.toHaveBeenCalled()
		expect(process.exitCode).toBe(FAILURE_EXIT_CODE)
	})
})
