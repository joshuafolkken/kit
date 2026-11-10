import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_pr_rest } from '#scripts/gh/git-gh-pr-rest'
import { git_spawn } from '#scripts/git/git-spawn'
import { issue_cite } from '#scripts/issue/issue-cite'
import { error_text } from '#scripts/lib/error-message'

// What lets `josh issue:already-done` close an Issue (joshuafolkken/kit#7093): evidence citing a pull
// request — `PR #N`, `pull request #N`, `merged in #N`, a `/pull/N` link — that GitHub answers as
// merged, or a commit SHA that `origin/main` contains (joshuafolkken/kit#7101). A link to another
// repository is read there. A cited pull request that is open, closed unmerged, missing or
// unreadable checks nothing, nor does a SHA off `origin/main`, unknown or unreadable, so either
// leaves the Issue open with the label.

const PULL_CITATIONS = [
	/\b(?:PR|pull request|merged (?:in|by|via))\s*#(?<number>\d+)/giu,
	/(?:github\.com\/(?<repo>[\w.-]+\/[\w.-]+))?\/pull\/(?<number>\d+)/gu,
]

// A lowercase hex word of 7 to 40 characters with a digit and a letter, so a plain number or an
// all-letter word such as `deadbeef` is not read as a commit.
const COMMIT_CITATION = /\b(?=[\da-f]*\d)(?=[\da-f]*[a-f])[\da-f]{7,40}\b/gu
const MAIN_REF = 'origin/main'
// `git merge-base --is-ancestor` answers "not an ancestor" with exit 1; anything else is a failed read.
const NOT_ANCESTOR_EXIT_CODE = 1

interface PullCitation {
	number: string
	repo: string | undefined
}

function to_citation(match: RegExpExecArray): PullCitation {
	return { number: match.groups?.['number'] ?? '', repo: match.groups?.['repo'] }
}

// The dedup key and the name the printed reason gives the citation.
function cite_of(citation: PullCitation): string {
	return issue_cite.plain_for('terminal', citation.number, citation.repo)
}

function cited_pulls(evidence: string): Array<PullCitation> {
	const citations = PULL_CITATIONS.flatMap((pattern) =>
		[...evidence.matchAll(pattern)].map((match) => to_citation(match)),
	)

	return [...new Map(citations.map((citation) => [cite_of(citation), citation])).values()]
}

// Why the citation does not check, or `undefined` once GitHub answers it merged. A failed read is
// one more citation that does not check, never a close.
async function unmerged_reason(citation: PullCitation): Promise<string | undefined> {
	const cite = cite_of(citation)

	try {
		const path = git_gh_api_path.pull_api_path(citation.number, citation.repo)
		const pull = git_gh_pr_rest.parse_rest_pull(await git_gh_exec.exec_gh_api({ path }))

		return git_gh_pr_rest.is_merged(pull) ? undefined : `${cite} is not merged`
	} catch (error) {
		return `${cite} not read: ${error_text.message_of(error)}`
	}
}

function cited_commits(evidence: string): Array<string> {
	return [...new Set(evidence.match(COMMIT_CITATION))]
}

function is_not_ancestor(error: unknown): boolean {
	return error instanceof Error && 'exitCode' in error && error.exitCode === NOT_ANCESTOR_EXIT_CODE
}

// Why the commit does not check, or `undefined` once `origin/main` contains it. A SHA git does not
// know fails the read, so it is refused with the read failure, never closed.
async function off_main_reason(sha: string): Promise<string | undefined> {
	try {
		await git_spawn.read(['merge-base', '--is-ancestor', sha, MAIN_REF])

		return undefined
	} catch (error) {
		if (is_not_ancestor(error)) return `${sha} is not on ${MAIN_REF}`

		return `${sha} not read: ${error_text.message_of(error)}`
	}
}

// Why the evidence does not let the Issue close, or `undefined` when one cited pull request is merged
// or one cited commit is on `origin/main`.
async function close_refusal(evidence: string): Promise<string | undefined> {
	const checks = [
		...cited_pulls(evidence).map(async (citation) => await unmerged_reason(citation)),
		...cited_commits(evidence).map(async (sha) => await off_main_reason(sha)),
	]
	if (checks.length === 0) return 'the evidence cites no pull request or commit'
	const reasons = await Promise.all(checks)
	if (reasons.includes(undefined)) return undefined

	return reasons.join('; ')
}

const already_done_citation = { close_refusal }

export { already_done_citation }
