import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_error } from './git-error'

const PROCESS_EXIT_CALLED = 'process.exit called'
const ERROR_PREFIX = '❌ Error:'
const TEST_ERROR_MSG = 'test error'
const STRING_ERROR_MSG = 'string error'
const INNER_CAUSE_MSG = 'inner cause'

beforeEach(() => {
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error(PROCESS_EXIT_CALLED)
	})
	vi.spyOn(console, 'error')
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_error.handle', () => {
	it('logs error message and calls process.exit', () => {
		expect(() => {
			git_error.handle(new Error(TEST_ERROR_MSG))
		}).toThrow(PROCESS_EXIT_CALLED)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(ERROR_PREFIX, TEST_ERROR_MSG)
	})

	it('handles non-Error input', () => {
		expect(() => {
			git_error.handle(STRING_ERROR_MSG)
		}).toThrow(PROCESS_EXIT_CALLED)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith(ERROR_PREFIX, STRING_ERROR_MSG)
	})

	it('logs cause message when error has an Error cause', () => {
		const error = new Error('outer')

		error.cause = new Error(INNER_CAUSE_MSG)

		expect(() => {
			git_error.handle(error)
		}).toThrow(PROCESS_EXIT_CALLED)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith('💡 Details:', INNER_CAUSE_MSG)
	})
})

describe('git_error.display_branch_mismatch_error', () => {
	it('logs branch info and calls process.exit', () => {
		expect(() => {
			git_error.display_branch_mismatch_error('feature', 'main')
		}).toThrow(PROCESS_EXIT_CALLED)

		expect(vi.mocked(console.error)).toHaveBeenCalledWith('Current branch: feature')
		expect(vi.mocked(console.error)).toHaveBeenCalledWith('Expected branch: main')
	})
})
