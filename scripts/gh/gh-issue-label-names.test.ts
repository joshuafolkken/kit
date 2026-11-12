import { afterEach, describe, expect, it, vi } from 'vitest'
import { gh_issue_label_names } from './gh-issue-label-names'
import { git_gh_exec } from './git-gh-exec'

// joshuafolkken/kit#7354: one synchronous label reader shared by the ship-phase cap and the pull request
// classification.

afterEach(() => {
	vi.restoreAllMocks()
})

describe('gh_issue_label_names.read_sync', () => {
	it('reads every page of the label names, dropping blank lines', () => {
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api_sync').mockReturnValue('bug\nhaiku\n')

		expect(gh_issue_label_names.read_sync('7354', 'owner/repo')).toEqual(['bug', 'haiku'])
		expect(exec).toHaveBeenCalledWith({
			path: 'repos/owner/repo/issues/7354/labels',
			should_paginate: true,
			jq_filter: '.[].name',
		})
	})

	it('throws when the read fails', () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api_sync').mockImplementation(() => {
			throw new Error('gh failed')
		})

		expect(() => gh_issue_label_names.read_sync('7354')).toThrow('gh failed')
	})
})
