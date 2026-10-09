// Captures the number, so the one pattern answers every question asked of a PR body: whether the
// linked issue will auto-close, which issue that is when the invocation did not say,
// and whether a merged pull request closes a child a `backlogrun` judged
// unfinished. A second pattern would be two readings of "closes #N" to disagree.
const CLOSES_PATTERN = /closes\s+#(\d+)/iu

function parse_closes_issue_number(body: string | undefined): string | undefined {
	if (body === undefined) return undefined

	return CLOSES_PATTERN.exec(body)?.[1]
}

const git_closes_keyword = { parse_closes_issue_number }

export { git_closes_keyword }
