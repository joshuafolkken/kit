// cspell:words coderabbit coderabbitai

type FindingKind = 'blocker' | 'none'

interface ReviewComment {
	body: string
	author_login: string
	url: string | undefined
}

interface ClassifiedFinding {
	author_login: string
	url: string | undefined
	summary: string
	kind: FindingKind
}

interface ClassifiedFindings {
	blockers: ReadonlyArray<ClassifiedFinding>
}

const CLAUDE_AUTHORS: ReadonlySet<string> = new Set(['claude', 'claude[bot]'])
const CODERABBIT_AUTHORS: ReadonlySet<string> = new Set(['coderabbitai', 'coderabbitai[bot]'])

const CLAUDE_BLOCKER_HEADINGS: ReadonlyArray<RegExp> = [
	/^#{2,4}\s+Issues\b/mu,
	/^#{2,4}\s+Problem\b/mu,
	/^#{3,4}\s+Logic bug\b/imu,
	/^#{3,4}\s+\d+\.\s+/mu,
]

const CODERABBIT_ACTIONABLE_PATTERN = /Actionable comments posted:\s*(\d+)/iu
const CODERABBIT_RATE_LIMIT_PATTERNS: ReadonlyArray<RegExp> = [
	/rate limited by coderabbit\.ai/iu,
	/Rate limit exceeded/iu,
]

const HEADING_PREFIX_PATTERN = /^#{2,4}\s+/u
const NEWLINE_CHAR = '\n'
const NOT_FOUND_INDEX = -1
const EMPTY_COUNT = 0
const CLAUDE_DEFAULT_SUMMARY = 'Claude Review finding'

function is_claude_author(login: string): boolean {
	return CLAUDE_AUTHORS.has(login)
}

function is_coderabbit_author(login: string): boolean {
	return CODERABBIT_AUTHORS.has(login)
}

function matches_claude_blocker(body: string): boolean {
	return CLAUDE_BLOCKER_HEADINGS.some((pattern) => pattern.test(body))
}

function parse_coderabbit_actionable(body: string): number {
	const match = CODERABBIT_ACTIONABLE_PATTERN.exec(body)
	const raw = match?.[1]
	if (raw === undefined) return EMPTY_COUNT
	const count = Number(raw)

	return Number.isFinite(count) ? count : EMPTY_COUNT
}

function is_coderabbit_rate_limit(body: string): boolean {
	return CODERABBIT_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(body))
}

function slice_line_at(body: string, start_index: number): string {
	const line_end = body.indexOf(NEWLINE_CHAR, start_index)

	return line_end === NOT_FOUND_INDEX ? body.slice(start_index) : body.slice(start_index, line_end)
}

function extract_heading_text(body: string, pattern: RegExp): string | undefined {
	const match = pattern.exec(body)
	if (match === null) return undefined
	const line = slice_line_at(body, match.index)

	return line.replace(HEADING_PREFIX_PATTERN, '').trim()
}

function extract_blocker_heading(body: string): string {
	for (const pattern of CLAUDE_BLOCKER_HEADINGS) {
		const heading = extract_heading_text(body, pattern)
		if (heading !== undefined) return heading
	}

	return ''
}

function build_none_finding(comment: ReviewComment): ClassifiedFinding {
	return { author_login: comment.author_login, url: comment.url, kind: 'none', summary: '' }
}

function claude_summary(body: string): string {
	const heading = extract_blocker_heading(body)

	return heading.length > 0 ? heading : CLAUDE_DEFAULT_SUMMARY
}

function classify_claude_comment(comment: ReviewComment): ClassifiedFinding {
	if (!matches_claude_blocker(comment.body)) return build_none_finding(comment)

	return {
		author_login: comment.author_login,
		url: comment.url,
		kind: 'blocker',
		summary: claude_summary(comment.body),
	}
}

function build_coderabbit_blocker(comment: ReviewComment, count: number): ClassifiedFinding {
	return {
		author_login: comment.author_login,
		url: comment.url,
		kind: 'blocker',
		summary: `CodeRabbit actionable comments posted: ${String(count)}`,
	}
}

function classify_coderabbit_comment(comment: ReviewComment): ClassifiedFinding {
	if (is_coderabbit_rate_limit(comment.body)) return build_none_finding(comment)
	const count = parse_coderabbit_actionable(comment.body)
	if (count === EMPTY_COUNT) return build_none_finding(comment)

	return build_coderabbit_blocker(comment, count)
}

function classify_comment(comment: ReviewComment): ClassifiedFinding {
	if (is_claude_author(comment.author_login)) return classify_claude_comment(comment)
	if (is_coderabbit_author(comment.author_login)) return classify_coderabbit_comment(comment)

	return build_none_finding(comment)
}

function classify_ai_review_comments(comments: ReadonlyArray<ReviewComment>): ClassifiedFindings {
	const classified = comments.map((comment) => classify_comment(comment))

	return { blockers: classified.filter((entry) => entry.kind === 'blocker') }
}

const git_ai_review_scan = {
	classify_ai_review_comments,
}

export { git_ai_review_scan, classify_ai_review_comments }
export type { ReviewComment, ClassifiedFinding, ClassifiedFindings, FindingKind }
