import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_messages } from './git-pr-messages'

beforeEach(() => {
	vi.spyOn(console, 'info')
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_pr_messages.display_success_message', () => {
	it('logs all checks passed message', () => {
		git_pr_messages.display_success_message()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith('✅ All checks passed successfully.')
	})
})

describe('git_pr_messages.display_error_message', () => {
	it('logs PR conflicts message', () => {
		git_pr_messages.display_error_message()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith('⚠️  PR has conflicts or merge issues.')
	})
})

describe('git_pr_messages.display_merged_pr_message', () => {
	it('logs already merged message', () => {
		git_pr_messages.display_merged_pr_message()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			'ℹ️  Existing PR is already merged. Creating a new PR...',
		)
	})
})

describe('git_pr_messages.display_pr_exists_message', () => {
	it('logs PR already exists message', () => {
		git_pr_messages.display_pr_exists_message()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith('ℹ️  Pull request already exists.')
	})
})

describe('git_pr_messages.display_pr_url', () => {
	it('logs formatted PR URL', () => {
		git_pr_messages.display_pr_url('https://example.com/pr/1')

		expect(vi.mocked(console.info)).toHaveBeenCalledWith('🔗 PR: https://example.com/pr/1')
	})
})
