// cspell:words coderabbit coderabbitai
import {
	classify_ai_review_comments,
	type ClassifiedFinding,
	type ReviewComment,
} from './git-ai-review-scan'
import { git_gh_command } from './git-gh-command'
import { parse_json_array_or_undefined } from './parse-json-array'
import { ai_review_pull_comment_schema } from './schemas'
import { telegram_notify, type TelegramSendInput } from './telegram-notify'

interface TelegramContext {
	repo_name: string | undefined
	issue_title: string | undefined
	issue_url: string | undefined
	pr_url: string | undefined
}

interface AiReviewPullComment {
	body?: string | undefined
	url?: string | undefined
	author?: { login?: string | undefined } | undefined
}

// `undefined` when the answer was not a listing at all. `parse_json_array_safe` returned `[]` for
// that, which this gate reads as "no reviewer left a finding" (joshuafolkken/kit#973).
function parse_ai_review_comments(
	raw_json: string | undefined,
): Array<AiReviewPullComment> | undefined {
	if (raw_json === undefined) return undefined

	return parse_json_array_or_undefined(raw_json, ai_review_pull_comment_schema)
}

function to_review_comment(raw: AiReviewPullComment): ReviewComment {
	return {
		body: raw.body ?? '',
		author_login: raw.author?.login ?? '',
		url: raw.url,
	}
}

function format_ai_review_finding(finding: ClassifiedFinding): string {
	const suffix = finding.url === undefined ? '' : ` — ${finding.url}`

	return `- ${finding.author_login}: ${finding.summary}${suffix}`
}

// Temporary (kit#753): CodeRabbit findings are surfaced as console info and audit notes for the
// completion notification instead of blocking the merge. Revert together with kit#752.
function log_info_findings(infos: ReadonlyArray<ClassifiedFinding>): Array<string> {
	if (infos.length === 0) return []

	console.warn('⚠ CodeRabbit review is non-blocking (temporary policy — kit#753):')

	for (const info of infos) {
		console.warn(format_ai_review_finding(info))
	}

	return infos.map((info) => `CodeRabbit skipped (kit#753): ${info.summary}`)
}

function build_ai_review_blocker_body(blockers: ReadonlyArray<ClassifiedFinding>): string {
	const lines = ['AI reviewer findings remain unresolved.', '']

	for (const blocker of blockers) {
		lines.push(format_ai_review_finding(blocker))
	}

	return lines.join('\n')
}

function build_ai_review_ignore_comment(
	reason: string,
	blockers: ReadonlyArray<ClassifiedFinding>,
): string {
	const lines = [
		'Some AI reviewer findings were intentionally left unresolved.',
		`Reason: ${reason.trim()}`,
		'Affected comments:',
	]

	for (const blocker of blockers) {
		lines.push(`- ${blocker.author_login}: ${blocker.summary} (${blocker.url ?? 'no-url'})`)
	}

	return lines.join('\n')
}

function build_confirmation_input(input: {
	context: TelegramContext
	body: string
}): TelegramSendInput {
	return {
		task_type: 'confirmation',
		repo_name: input.context.repo_name,
		issue_title: input.context.issue_title,
		body: input.body,
		issue_url: input.context.issue_url,
		pr_url: input.context.pr_url,
	}
}

async function notify_ai_review_confirmation(input: {
	context: TelegramContext
	body: string
}): Promise<void> {
	await telegram_notify.send(build_confirmation_input(input))
}

function has_ignore_reason(reason: string | undefined): reason is string {
	return reason !== undefined && reason.trim().length > 0
}

async function fetch_review_comments(
	branch_name: string,
): Promise<Array<ReviewComment> | undefined> {
	const parsed = parse_ai_review_comments(await git_gh_command.pr_get_comments(branch_name))

	return parsed?.map((comment) => to_review_comment(comment))
}

async function handle_blockers(input: {
	branch_name: string
	ignore_reason: string | undefined
	context: TelegramContext
	blockers: ReadonlyArray<ClassifiedFinding>
}): Promise<void> {
	const body = build_ai_review_blocker_body(input.blockers)

	if (has_ignore_reason(input.ignore_reason)) {
		const ignore_comment = build_ai_review_ignore_comment(input.ignore_reason, input.blockers)

		await git_gh_command.pr_comment(input.branch_name, ignore_comment)

		return
	}

	await notify_ai_review_confirmation({ context: input.context, body })

	throw new Error(body)
}

// A gate that could not be read is not a gate that passed. An unreadable listing is handled exactly
// like an unresolved finding — the same `confirmation` Telegram, the same non-zero exit — because
// what it means is the same: nobody has confirmed the reviewers had nothing to say
// (joshuafolkken/kit#973). An ignore reason still gets past it, for the same reason it gets past a
// real finding: the person has looked.
const UNREADABLE_COMMENTS_BODY =
	'The AI reviewer comments could not be read, so no finding could be ruled out.\n' +
	'Re-run `pnpm josh followup` once the read succeeds, or pass an ignore reason.'

// The audit note a bypassed run carries into its completion notification. Without it a run that
// never read the gate reports exactly like one that read it and found nothing.
const UNREADABLE_COMMENTS_NOTE = 'AI reviewer comments could not be read; the scan was bypassed.'

async function handle_unreadable_comments(input: {
	branch_name: string
	ignore_reason: string | undefined
	context: TelegramContext
}): Promise<Array<string>> {
	if (has_ignore_reason(input.ignore_reason)) {
		await git_gh_command.pr_comment(
			input.branch_name,
			`${UNREADABLE_COMMENTS_BODY}\nReason: ${input.ignore_reason.trim()}`,
		)

		return [UNREADABLE_COMMENTS_NOTE]
	}

	await notify_ai_review_confirmation({ context: input.context, body: UNREADABLE_COMMENTS_BODY })

	throw new Error(UNREADABLE_COMMENTS_BODY)
}

async function handle_ai_review_findings(input: {
	branch_name: string
	ignore_reason: string | undefined
	context: TelegramContext
}): Promise<Array<string>> {
	const review_comments = await fetch_review_comments(input.branch_name)

	if (review_comments === undefined) return await handle_unreadable_comments(input)

	const { blockers, infos } = classify_ai_review_comments(review_comments)
	const skip_notes = log_info_findings(infos)

	if (blockers.length > 0) await handle_blockers({ ...input, blockers })

	return skip_notes
}

const git_pr_ai_review = {
	handle_ai_review_findings,
	parse_ai_review_comments,
	to_review_comment,
	has_ignore_reason,
}

export {
	git_pr_ai_review,
	handle_ai_review_findings,
	parse_ai_review_comments,
	to_review_comment,
	has_ignore_reason,
	UNREADABLE_COMMENTS_BODY,
	UNREADABLE_COMMENTS_NOTE,
}
export type { TelegramContext, AiReviewPullComment }
