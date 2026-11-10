import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_pr_rest } from '#scripts/gh/git-gh-pr-rest'
import { issue_cite } from '#scripts/issue/issue-cite'
import { error_text } from '#scripts/lib/error-message'

// What lets `josh issue:already-done` close an Issue (joshuafolkken/kit#7093): evidence citing a pull
// request — `PR #N`, `pull request #N`, `merged in #N`, a `/pull/N` link — that GitHub answers as
// merged. A link to another repository is read there. A cited pull request that is open, closed
// unmerged, missing or unreadable checks nothing, and a commit SHA alone is not checked yet
// (joshuafolkken/kit#7101), so either leaves the Issue open with the label.

const PULL_CITATIONS = [
	/\b(?:PR|pull request|merged (?:in|by|via))\s*#(?<number>\d+)/giu,
	/(?:github\.com\/(?<repo>[\w.-]+\/[\w.-]+))?\/pull\/(?<number>\d+)/gu,
]

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

// Why the evidence does not let the Issue close, or `undefined` when one cited pull request is merged.
async function close_refusal(evidence: string): Promise<string | undefined> {
	const citations = cited_pulls(evidence)
	if (citations.length === 0) return 'the evidence cites no pull request'
	const reasons = await Promise.all(
		citations.map(async (citation) => await unmerged_reason(citation)),
	)
	if (reasons.includes(undefined)) return undefined

	return reasons.join('; ')
}

const already_done_citation = { close_refusal }

export { already_done_citation }
