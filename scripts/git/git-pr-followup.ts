import { version_targets } from '#scripts/version/version-targets'
import { git_epic_close } from './git-epic-close'
import { git_gh_command } from './git-gh-command'
import { git_notify, type GitNotifyConfig } from './git-notify'
import { git_pr_ai_review, has_ignore_reason, type TelegramContext } from './git-pr-ai-review'
import { git_pr_checks } from './git-pr-checks'
import { is_coderabbit_check } from './git-pr-checks-eval'
import { CHECK_STATUS_PASS, type PrStateSnapshot } from './git-pr-checks-parse'
import { parse_json_array_safe } from './parse-json-array'
import { pull_comment_schema } from './schemas'
import { telegram_notify, type TelegramSendInput, type TelegramTaskType } from './telegram-notify'

// cspell:words coderabbit coderabbitai

const CODERABBIT_AUTHOR = 'coderabbitai[bot]'
const CLOSES_PATTERN = /closes\s+#\d+/iu
const CODERABBIT_FLAG = '_⚠️ Potential issue_'
const CODERABBIT_RESOLVED = '✅ Addressed in commit'
const GITHUB_PULL_URL_PATTERN = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+$/u
const REPO_NAME_SEPARATOR = '/'

function parse_repo_name(name_with_owner: string | undefined): string | undefined {
	if (name_with_owner === undefined) return undefined
	const parts = name_with_owner.split(REPO_NAME_SEPARATOR)

	return parts.at(-1)
}

function build_telegram_input(input: {
	task_type: TelegramTaskType
	context: TelegramContext
	body: string | undefined
}): TelegramSendInput {
	return {
		task_type: input.task_type,
		repo_name: input.context.repo_name,
		issue_title: input.context.issue_title,
		body: input.body,
		issue_url: input.context.issue_url,
		pr_url: input.context.pr_url,
	}
}

function build_issue_url(
	pr_url: string | undefined,
	issue_number: string | undefined,
): string | undefined {
	if (pr_url === undefined || issue_number === undefined) return undefined
	const match = GITHUB_PULL_URL_PATTERN.exec(pr_url)
	if (match?.[1] === undefined) return undefined

	return `${match[1]}/issues/${issue_number}`
}

interface PullComment {
	body?: string | undefined
	html_url?: string | undefined
	user?: { login?: string | undefined } | undefined
}

interface FollowupInput {
	branch_name: string
	issue_number: string | undefined
	notify_config: GitNotifyConfig | undefined
	coderabbit_ignore_reason: string | undefined
	ai_review_ignore_reason: string | undefined
	is_skip_watch: boolean
	should_merge: boolean
}

function parse_pull_comments(raw_json: string): Array<PullComment> {
	return parse_json_array_safe(raw_json, pull_comment_schema)
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

function has_closes_keyword(body: string | undefined): boolean {
	if (body === undefined) return false

	return CLOSES_PATTERN.test(body)
}

async function warn_if_missing_closes(branch_name: string): Promise<void> {
	const body = await git_gh_command.pr_get_body(branch_name)

	if (has_closes_keyword(body)) return

	console.warn('')
	console.warn(
		'⚠️  PR body is missing a "closes #N" keyword — the linked Issue will not auto-close on merge.',
	)
	console.warn('   Recovery: pnpm josh pr  (or: pnpm josh git -y --skip-commit --skip-push)')
	console.warn('')
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
async function handle_coderabbit_findings(input: {
	branch_name: string
	ignore_reason: string | undefined
}): Promise<Array<string>> {
	const comments_json = await git_gh_command.pr_get_review_comments(input.branch_name)
	const unresolved_urls = read_unresolved_cr_urls(parse_pull_comments(comments_json))
	if (unresolved_urls.length === 0) return []

	if (has_ignore_reason(input.ignore_reason)) {
		const reason_comment = build_ignore_reason_comment(input.ignore_reason, unresolved_urls)

		await git_gh_command.pr_comment(input.branch_name, reason_comment)
	} else {
		log_unresolved_coderabbit(unresolved_urls)
	}

	return unresolved_urls.map((url) => `CodeRabbit unresolved comment skipped (kit#753): ${url}`)
}

function build_notify_body(input: {
	notify_config: GitNotifyConfig
	issue_number: string | undefined
	pr_url: string | undefined
}): string {
	return git_notify.build_completion_comment_body({
		message: input.notify_config.message,
		issue_number: input.issue_number,
		pr_url: input.pr_url,
		mentions: input.notify_config.mentions,
	})
}

function is_blank_issue_body(body: string | undefined): boolean {
	if (body === undefined) return true

	return body.trim().length === 0
}

async function post_notify_issue(input: {
	issue_number: string | undefined
	body: string
}): Promise<void> {
	if (input.issue_number === undefined) {
		throw new Error('Issue number is required for issue notification.')
	}

	const current_body = await git_gh_command.issue_get_body(input.issue_number)
	const should_edit_body = current_body !== undefined && is_blank_issue_body(current_body)

	await (should_edit_body
		? git_gh_command.issue_edit_body(input.issue_number, input.body)
		: git_gh_command.issue_comment(input.issue_number, input.body))
}

function should_notify_pr(target: GitNotifyConfig['target']): boolean {
	return target === 'pr' || target === 'both'
}

function should_notify_issue(target: GitNotifyConfig['target']): boolean {
	return target === 'issue' || target === 'both'
}

async function post_completion_notification(input: {
	branch_name: string
	issue_number: string | undefined
	notify_config: GitNotifyConfig | undefined
	pr_url: string | undefined
}): Promise<void> {
	if (input.notify_config === undefined) return

	const body = build_notify_body({
		notify_config: input.notify_config,
		issue_number: input.issue_number,
		pr_url: input.pr_url,
	})
	const { target } = input.notify_config

	if (should_notify_pr(target)) {
		await git_gh_command.pr_comment(input.branch_name, body)
	}

	if (should_notify_issue(target)) {
		await post_notify_issue({ issue_number: input.issue_number, body })
	}
}

async function run_checks(input: {
	branch_name: string
	is_skip_watch: boolean
}): Promise<PrStateSnapshot> {
	if (!input.is_skip_watch) {
		console.info('')
		console.info('📊 Watching PR checks...')
		await git_gh_command.pr_checks_watch(input.branch_name)
	}

	return await git_pr_checks.wait_for_pr_success(input.branch_name)
}

// Temporary (kit#753): record every CodeRabbit check that was not passing when the merge gate
// opened, so a merge shipped without CodeRabbit review stays auditable.
function read_coderabbit_skip_notes(snapshot: PrStateSnapshot): Array<string> {
	return snapshot.rollup
		.filter((check) => is_coderabbit_check(check.name))
		.filter((check) => check.status !== CHECK_STATUS_PASS)
		.map(
			(check) =>
				`CodeRabbit check skipped (kit#753): ${check.name} was ${check.status} at merge time`,
		)
}

async function fetch_telegram_context(input: {
	branch_name: string
	issue_number: string | undefined
}): Promise<TelegramContext> {
	const name_with_owner = await git_gh_command.repo_get_name_with_owner()
	const repo_name = parse_repo_name(name_with_owner)
	const issue_title =
		input.issue_number === undefined
			? undefined
			: await git_gh_command.issue_get_title(input.issue_number)
	const pr_url = await git_gh_command.pr_get_url(input.branch_name)
	const issue_url = build_issue_url(pr_url, input.issue_number)

	return { repo_name, issue_title, issue_url, pr_url }
}

async function notify_completion(
	context: TelegramContext,
	skip_notes: ReadonlyArray<string>,
): Promise<void> {
	const version_line = version_targets.project_version_line(process.cwd())
	const body = [version_line, ...skip_notes].join('\n')

	await telegram_notify.send(
		build_telegram_input({
			task_type: 'completion',
			context,
			body,
		}),
	)
}

async function run_review_checks(
	input: FollowupInput,
	context: TelegramContext,
): Promise<Array<string>> {
	const snapshot = await run_checks({
		branch_name: input.branch_name,
		is_skip_watch: input.is_skip_watch,
	})
	const check_notes = read_coderabbit_skip_notes(snapshot)
	const comment_notes = await handle_coderabbit_findings({
		branch_name: input.branch_name,
		ignore_reason: input.coderabbit_ignore_reason,
	})
	const ai_review_notes = await git_pr_ai_review.handle_ai_review_findings({
		branch_name: input.branch_name,
		ignore_reason: input.ai_review_ignore_reason,
		context,
	})

	return [...check_notes, ...comment_notes, ...ai_review_notes]
}

async function run(input: FollowupInput): Promise<void> {
	await warn_if_missing_closes(input.branch_name)

	const context = await fetch_telegram_context({
		branch_name: input.branch_name,
		issue_number: input.issue_number,
	})

	const skip_notes = await run_review_checks(input, context)

	await notify_completion(context, skip_notes)

	if (input.should_merge) {
		await git_gh_command.pr_merge(input.branch_name)
	}

	await post_completion_notification({
		branch_name: input.branch_name,
		issue_number: input.issue_number,
		notify_config: input.notify_config,
		pr_url: context.pr_url,
	})

	await git_epic_close.close_completed_epics({
		issue_number: input.issue_number,
		is_merged: input.should_merge,
	})
}

const git_pr_followup = {
	run,
}

export {
	git_pr_followup,
	parse_repo_name,
	is_blank_issue_body,
	post_notify_issue,
	build_telegram_input,
	has_closes_keyword,
	warn_if_missing_closes,
}
export type { FollowupInput }
export type { TelegramContext } from './git-pr-ai-review'
