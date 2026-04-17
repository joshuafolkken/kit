// cspell:words coderabbit coderabbitai
import { describe, expect, it } from 'vitest'
import { classify_ai_review_comments, type ReviewComment } from './git-ai-review-scan'

const COMMENT_URL = 'https://github.com/owner/repo/pull/1#issuecomment-1'
const CLAUDE = 'claude'
const CODERABBIT = 'coderabbitai'
const CODERABBIT_BOT = 'coderabbitai[bot]'
const CLAUDE_REVIEW_HEADING = '## Code Review — PR #123'
const CODERABBIT_SUMMARY_MARKER = '<!-- summary by coderabbit.ai -->'
const TS_CODE_FENCE = '```ts'
const CODE_FENCE_END = '```'
const CLAUDE_ISSUES_HEADING = '### Issues'

function make_comment(input: {
	author_login: string
	body: string
	url?: string | undefined
}): ReviewComment {
	return {
		author_login: input.author_login,
		body: input.body,
		url: input.url ?? COMMENT_URL,
	}
}

const CLAUDE_ISSUES_BODY = [
	CLAUDE_REVIEW_HEADING,
	'',
	CLAUDE_ISSUES_HEADING,
	'',
	'#### Logic bug — `is_finite_number` does not exclude `Infinity`',
	TS_CODE_FENCE,
	'return typeof value === "number" && !Number.isNaN(value)',
	CODE_FENCE_END,
].join('\n')

const CLAUDE_ACK_BODY = [
	`${CLAUDE_REVIEW_HEADING} (round 5 / current diff)`,
	'',
	'All three issues flagged in the previous round are resolved:',
	'- helper replaced with `Number.isFinite` ✓',
].join('\n')

const CLAUDE_NUMBERED_BODY = [
	`${CLAUDE_REVIEW_HEADING} (round 8)`,
	'',
	'Previous rounds addressed main correctness. Two items remain unresolved.',
	'',
	'### 1. Magic number — `kv-cache-entry.spec.ts:7`',
	'',
	TS_CODE_FENCE,
	'const ONE_HOUR_MS = 3_600_000',
	CODE_FENCE_END,
].join('\n')

const CODERABBIT_ACTIONABLE_BODY = [
	CODERABBIT_SUMMARY_MARKER,
	'',
	'Actionable comments posted: 2',
	'',
	'Review details...',
].join('\n')

const CODERABBIT_CLEAN_BODY = [
	CODERABBIT_SUMMARY_MARKER,
	'',
	'No actionable comments were generated in the recent review. 🎉',
].join('\n')

const CODERABBIT_RATE_LIMIT_BODY = [
	'> [!NOTE]',
	'> ## ⚠️ rate limited by coderabbit.ai',
	'>',
	'> Quota resets in 42 minutes.',
].join('\n')

const HUMAN_BODY = [
	'Nice work on this PR.',
	'',
	CLAUDE_ISSUES_HEADING,
	'',
	'Reusing the Claude heading intentionally — classifier should ignore non-AI authors.',
].join('\n')

describe('classify_ai_review_comments — Claude Review', () => {
	it('flags comment with "### Issues" heading as blocker', () => {
		const result = classify_ai_review_comments([
			make_comment({ author_login: CLAUDE, body: CLAUDE_ISSUES_BODY }),
		])

		expect(result.blockers).toHaveLength(1)
		expect(result.blockers[0]?.kind).toBe('blocker')
		expect(result.blockers[0]?.author_login).toBe(CLAUDE)
		expect(result.blockers[0]?.summary).toContain('Issues')
	})

	it('does not flag acknowledgment ("All issues resolved")', () => {
		const result = classify_ai_review_comments([
			make_comment({ author_login: CLAUDE, body: CLAUDE_ACK_BODY }),
		])

		expect(result.blockers).toHaveLength(0)
	})

	it('flags numbered finding heading ("### 1.") as blocker', () => {
		const result = classify_ai_review_comments([
			make_comment({ author_login: CLAUDE, body: CLAUDE_NUMBERED_BODY }),
		])

		expect(result.blockers).toHaveLength(1)
		expect(result.blockers[0]?.summary).toMatch(/\b1\./u)
	})
})

describe('classify_ai_review_comments — CodeRabbit', () => {
	it('flags "Actionable comments posted: N" (N > 0) as blocker', () => {
		const result = classify_ai_review_comments([
			make_comment({
				author_login: CODERABBIT,
				body: CODERABBIT_ACTIONABLE_BODY,
			}),
		])

		expect(result.blockers).toHaveLength(1)
		expect(result.blockers[0]?.summary).toContain('2')
	})

	it('does not flag "No actionable comments" summary', () => {
		const result = classify_ai_review_comments([
			make_comment({ author_login: CODERABBIT, body: CODERABBIT_CLEAN_BODY }),
		])

		expect(result.blockers).toHaveLength(0)
	})

	it('does not flag rate-limit notice', () => {
		const result = classify_ai_review_comments([
			make_comment({
				author_login: CODERABBIT_BOT,
				body: CODERABBIT_RATE_LIMIT_BODY,
			}),
		])

		expect(result.blockers).toHaveLength(0)
	})
})

describe('classify_ai_review_comments — general input', () => {
	it('ignores non-AI authors even when body mimics AI reviewer markers', () => {
		const result = classify_ai_review_comments([
			make_comment({ author_login: 'joshuafolkken', body: HUMAN_BODY }),
		])

		expect(result.blockers).toHaveLength(0)
	})

	it('returns empty blockers for empty input', () => {
		const result = classify_ai_review_comments([])

		expect(result.blockers).toHaveLength(0)
	})

	it('collects blockers from a mixed batch', () => {
		const result = classify_ai_review_comments([
			make_comment({ author_login: CLAUDE, body: CLAUDE_ISSUES_BODY }),
			make_comment({ author_login: CLAUDE, body: CLAUDE_ACK_BODY }),
			make_comment({
				author_login: CODERABBIT,
				body: CODERABBIT_ACTIONABLE_BODY,
			}),
			make_comment({ author_login: CODERABBIT, body: CODERABBIT_CLEAN_BODY }),
		])
		const authors = result.blockers
			.map((entry) => entry.author_login)
			.toSorted((left, right) => left.localeCompare(right))

		expect(result.blockers).toHaveLength(2)
		expect(authors).toStrictEqual([CLAUDE, CODERABBIT])
	})
})
