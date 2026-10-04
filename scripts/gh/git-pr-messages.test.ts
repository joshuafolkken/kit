import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_pr_messages } from './git-pr-messages'

beforeEach(() => {
	vi.spyOn(console, 'info')
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_pr_messages.display_pr_opened_message', () => {
	it('logs that the pull request is open', () => {
		git_pr_messages.display_pr_opened_message()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith('✅ Pull request opened.')
	})

	// The message replaces a wait, so it has to say where the wait went (joshuafolkken/kit#1232).
	it('names the command that waits for the checks and merges', () => {
		git_pr_messages.display_pr_opened_message()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			'`pnpm josh followup` waits for the checks and merges.',
		)
	})

	it('claims nothing about the checks having passed', () => {
		git_pr_messages.display_pr_opened_message()

		const logged = vi.mocked(console.info).mock.calls.flat().join('\n')

		expect(logged).not.toContain('passed')
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
