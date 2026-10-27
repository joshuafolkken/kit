import { error_text } from '#scripts/lib/error-message'
import { gh_failure } from './git-gh-failure'

// GitHub refuses the single-pull JSON (`GET /pulls/{N}`) of some pull requests with
// `HTTP 422: … too many files changed`, every time, however few files the pull request changes — while
// the listing, the files, the diff and GraphQL all answer for the same one (joshuafolkken/kit#5226).
// The refusal is about that one response, so the branch-keyed reads fall back to the listing row
// rather than reporting the pull request unreadable.
const UNPROCESSABLE_STATUS = 422
const TOO_MANY_FILES_TEXT = 'too many files changed'

function is_too_many_files(error: unknown): boolean {
	if (gh_failure.failure_of(error)?.status !== UNPROCESSABLE_STATUS) return false

	return error_text.message_of(error).includes(TOO_MANY_FILES_TEXT)
}

const git_gh_pr_too_large = { is_too_many_files }

export { git_gh_pr_too_large }
