/**
 * CJK Unified Ideographs range + Hiragana + Katakana + CJK symbols.
 * Used to detect non-English issue titles that need translation.
 */
const CJK_PATTERN = /[\u3000-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\u{20000}-\u{2FA1F}]/u

const MAX_BRANCH_SLUG_LENGTH = 50

function has_cjk(text: string): boolean {
	return CJK_PATTERN.test(text)
}

function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.normalize('NFKD')
		.replaceAll(/[^a-z0-9]+/gu, '-')
		.replaceAll(/-+/gu, '-')
		.replaceAll(/(^-)|(-$)/gu, '')

	if (slug.length === 0) return 'update'

	return slug.length > MAX_BRANCH_SLUG_LENGTH
		? slug.slice(0, MAX_BRANCH_SLUG_LENGTH).replace(/-$/u, '')
		: slug
}

function suggest_branch_name(issue_number: number, title: string): string {
	return `${String(issue_number)}-${slugify(title)}`
}

interface IssuePrepResult {
	number: number
	title: string
	is_cjk: boolean
	suggested_branch: string
}

function prepare(issue_number: number, title: string): IssuePrepResult {
	return {
		number: issue_number,
		title,
		is_cjk: has_cjk(title),
		suggested_branch: suggest_branch_name(issue_number, title),
	}
}

const issue_logic = { has_cjk, slugify, suggest_branch_name, prepare }

export type { IssuePrepResult }
export { issue_logic }
