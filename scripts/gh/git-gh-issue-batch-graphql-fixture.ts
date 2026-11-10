import { vi } from 'vitest'
import { git_gh_issue_batch_graphql } from './git-gh-issue-batch-graphql'

// A batch read that answers nothing, so every issue falls through to the REST read the suite
// already mocks. Left real, `read_many` reaches `gh` through the transport and the unit suite's
// network guard fails the run (joshuafolkken/kit#6869).
function stub_unanswered_batch(): void {
	vi.spyOn(git_gh_issue_batch_graphql, 'read_many').mockResolvedValue(
		git_gh_issue_batch_graphql.empty_batch(),
	)
}

export { stub_unanswered_batch }
