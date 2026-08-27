import { git_gh_command } from './git-gh-command'
import { has_ignore_reason } from './git-pr-ai-review'
import { parse_json_array_or_undefined } from './parse-json-array'
import { pull_comment_schema } from './schemas'

// cspell:words coderabbit coderabbitai

// CodeRabbit's line comments, and what `followup` does about the unresolved ones. Split out of
// `git-pr-followup.ts` when that file passed its length limit; this is the sibling of
// `git-pr-ai-review.ts`, which already owned the summary-comment half of the same reviewer.

const CODERABBIT_AUTHOR = 'coderabbitai[bot]'
const CODERABBIT_FLAG = '_⚠️ Potential issue_'
const CODERABBIT_RESOLVED = '✅ Addressed in commit'

interface PullComment {
	body?: string | undefined
	html_url?: string | undefined
	user?: { login?: string | undefined } | undefined
}

// `undefined` when the listing could not be read, which is not the same as a pull request with no
// line comments (joshuafolkken/kit#973).
function parse_pull_comments(raw_json: string | undefined): Array<PullComment> | undefined {
	if (raw_json === undefined) return undefined

	return parse_json_array_or_undefined(raw_json, pull_comment_schema)
}

function read_unresolved_cr_urls(comments: ReadonlyArray<PullComment>): Array<string> {
	return comments
		.filter((comment) => comment.user?.login === CODERABBIT_AUTHOR)
		.filter((comment) => (comment.body ?? '').includes(CODERABBIT_FLAG))
		.filter((comment) => !(comment.body ?? '').includes(CODERABBIT_RESOLVED))
		.map((comment) => comment.html_url ?? '')
		.filter((url) => url.length > 0)
}

function build_ignore_reason_comment(reason: string, urls: ReadonlyArray<string>): string {
	const lines = [
		'Some CodeRabbit findings were intentionally left unresolved.',
		`Reason: ${reason.trim()}`,
		'Affected comments:',
	]

	for (const url of urls) {
		lines.push(`- ${url}`)
	}

	return lines.join('\n')
}

function log_unresolved_coderabbit(urls: ReadonlyArray<string>): void {
	console.warn('⚠ Unresolved CodeRabbit comments are non-blocking (temporary policy — kit#753):')

	for (const url of urls) {
		console.warn(`- ${url}`)
	}
}

// Temporary (kit#753): unresolved CodeRabbit line comments no longer block the merge. They are
// logged, returned as audit notes for the completion notification, and — when an ignore reason is
// supplied — still documented on the PR. Revert together with kit#752.
// Unreadable is reported, never blocked — the opposite of the AI review gate's handling of the same
// gap, and for the reason kit#753 gave: CodeRabbit does not block the merge at all right now, so an
// unreadable CodeRabbit listing cannot either. What it must not do is pass as "nothing unresolved",
// which is what the reader's old `'[]'` made of it (joshuafolkken/kit#973).
const UNREADABLE_CR_NOTE =
	'CodeRabbit line comments could not be read; unresolved findings were not checked (kit#753).'

// An ignore reason is recorded on the pull request here for the same reason it is on the branch
// below: it is the audit trail, not a way past a block — there is no block on this path. Dropping it
// would leave the completion note saying the listing went unread while the PR itself said nothing.
async function report_unreadable_cr(input: {
	branch_name: string
	ignore_reason: string | undefined
}): Promise<Array<string>> {
	console.warn(`⚠ ${UNREADABLE_CR_NOTE}`)

	if (has_ignore_reason(input.ignore_reason)) {
		const body = `${UNREADABLE_CR_NOTE}\nReason: ${input.ignore_reason.trim()}`

		await git_gh_command.pr_comment(input.branch_name, body)
	}

	return [UNREADABLE_CR_NOTE]
}

// Documented on the pull request when a reason was given, logged when it was not. Either way the
// finding is recorded rather than dropped — kit#753 removed the block, not the audit trail.
async function record_unresolved_cr(input: {
	branch_name: string
	ignore_reason: string | undefined
	unresolved_urls: ReadonlyArray<string>
}): Promise<void> {
	if (!has_ignore_reason(input.ignore_reason)) {
		log_unresolved_coderabbit(input.unresolved_urls)

		return
	}

	const reason_comment = build_ignore_reason_comment(input.ignore_reason, input.unresolved_urls)

	await git_gh_command.pr_comment(input.branch_name, reason_comment)
}

async function handle_coderabbit_findings(input: {
	branch_name: string
	ignore_reason: string | undefined
}): Promise<Array<string>> {
	const raw = await git_gh_command.pr_get_review_comments(input.branch_name)
	const comments = parse_pull_comments(raw)
	if (comments === undefined) return await report_unreadable_cr(input)
	const unresolved_urls = read_unresolved_cr_urls(comments)
	if (unresolved_urls.length === 0) return []

	await record_unresolved_cr({ ...input, unresolved_urls })

	return unresolved_urls.map((url) => `CodeRabbit unresolved comment skipped (kit#753): ${url}`)
}

const git_pr_coderabbit = {
	parse_pull_comments,
	read_unresolved_cr_urls,
	build_ignore_reason_comment,
	handle_coderabbit_findings,
}

export type { PullComment }
export { git_pr_coderabbit, UNREADABLE_CR_NOTE }
