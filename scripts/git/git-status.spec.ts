import { describe, expect, it } from 'vitest'
import { git_status } from './git-status'

describe('git_status.list_untracked_files', () => {
	it('extracts paths from "?? " porcelain lines and ignores other states', () => {
		const status_output = [
			' M scripts/git/git-staging.ts',
			'?? scripts/claude-settings.test.ts',
			'A  src/lib/new-thing.ts',
			'?? .claude/scheduled_tasks.lock',
			'MM existing.ts',
		].join('\n')

		const result = git_status.list_untracked_files(status_output)

		expect(result).toStrictEqual([
			'scripts/claude-settings.test.ts',
			'.claude/scheduled_tasks.lock',
		])
	})

	it('returns an empty array when there are no untracked files', () => {
		const status_output = [' M existing.ts', 'A  src/staged.ts'].join('\n')

		expect(git_status.list_untracked_files(status_output)).toStrictEqual([])
	})

	it('returns an empty array when the status output is empty', () => {
		expect(git_status.list_untracked_files('')).toStrictEqual([])
	})
})
