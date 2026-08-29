import { version_targets } from '#scripts/version/version-targets'
import { git_epic_close } from './git-epic-close'
import { git_gh_command } from './git-gh-command'
import { git_gh_helpers } from './git-gh-helpers'
import { git_notify, type GitNotifyConfig } from './git-notify'
import { git_pr_ai_review, type TelegramContext } from './git-pr-ai-review'
import { git_pr_checks } from './git-pr-checks'
import { is_coderabbit_check } from './git-pr-checks-eval'
import { CHECK_STATUS_PASS, git_pr_checks_parse, type PrStateSnapshot } from './git-pr-checks-parse'
import { git_pr_coderabbit } from './git-pr-coderabbit'
import { github_issue_url } from './github-issue-url'
import { telegram_notify, type TelegramSendInput, type TelegramTaskType } from './telegram-notify'

const CLOSES_PATTERN = /closes\s+#\d+/iu
// Named so a test can pin the note without restating it (joshuafolkken/kit#999).
const WATCH_FAILED_NOTE = 'pr checks --watch failed; falling through to polling'
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

// The sibling issue URL of a pull request: same repository, the number this run is closing. Read
// through the shared parser rather than a second pattern here, so the two cannot disagree about what
// a github.com URL looks like (joshuafolkken/kit#994).
function build_issue_url(
	pr_url: string | undefined,
	issue_number: string | undefined,
): string | undefined {
	if (issue_number === undefined) return undefined
	const target = github_issue_url.parse_pull(pr_url)
	if (target === undefined) return undefined

	return `${target.base_url}/issues/${issue_number}`
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

// The watch is a look ahead, not a gate. It fails when **any** check has failed — CodeRabbit
// included — and letting that escape ended the run before `evaluate_pr_state` could apply kit#753's
// CodeRabbit exemption at all. It only ever bit where every check finished inside the two-minute
// window, so a repository with a slow E2E never saw it and a fast one always would
// (joshuafolkken/kit#999). What the watch is has since changed — `gh pr checks --watch` went through
// GraphQL, so joshuafolkken/kit#1028 replaced it with the same poll loop bounded to two minutes —
// but its place here has not.
//
// Falling through costs nothing: whether the merge may proceed is decided in one place below, and a
// genuinely failing non-CodeRabbit check still ends the wait on the first poll by kit#990's
// fast-fail rather than by that failure.
// The watch fails for two different reasons — "a check failed" and "no checks reported on this
// branch" — and its own error does not say which. The pull request itself can: a failed check leaves
// a rollup, and a branch with no checks leaves it empty. Falling through on the empty case would
// trade a failure reported in seconds for the whole budget spent waiting on a required check that is
// missing rather than pending, so that one is rethrown and the old behavior kept.
//
// **Read from the raw payload, not from `parse_pr_state_snapshot`.** That parser never throws: a
// malformed answer or a schema mismatch degrades to `rollup: []`, which is indistinguishable there
// from a branch that genuinely has no checks. Rethrowing on it would put an unreadable answer back
// on the path this whole change exists to remove. So the question asked here is the narrow one —
// *is this definitely an empty rollup* — and every other outcome falls through.
function reads_as_empty_rollup(raw_json: string): boolean {
	const parsed = git_pr_checks_parse.parse_json_safe(raw_json)

	if (typeof parsed !== 'object' || parsed === null) return false
	if (!('statusCheckRollup' in parsed)) return false
	const { statusCheckRollup: rollup } = parsed

	return Array.isArray(rollup) && rollup.length === 0
}

// The read throws rather than answering `undefined`, so the `catch` is its only failure path.
//
// The **checks** half, not the whole snapshot: the question here is about `statusCheckRollup` alone,
// and reading the review listing to answer it paged a whole conversation for nothing
// (joshuafolkken/kit#1043).
async function has_no_checks(branch_name: string): Promise<boolean> {
	try {
		const checks = await git_gh_command.pr_get_checks_snapshot(branch_name)

		return reads_as_empty_rollup(checks.snapshot_json)
	} catch {
		// The read refines the swallow; it is not a gate of its own. An answer it cannot get is not
		// evidence of anything, so prefer falling through — the poll below reads the same state.
		return false
	}
}

async function handle_watch_failure(branch_name: string, error: unknown): Promise<void> {
	if (await has_no_checks(branch_name)) throw error

	// Swallowed, but never silently: the reason a run stopped early used to be this line, so it
	// stays visible even though it no longer decides anything.
	console.info(`⚠️ ${WATCH_FAILED_NOTE}: ${git_gh_helpers.get_error_message_with_stderr(error)}`)
}

async function watch_before_polling(branch_name: string): Promise<void> {
	console.info('')
	console.info('📊 Watching PR checks...')

	try {
		await git_gh_command.pr_checks_watch(branch_name)
	} catch (error) {
		await handle_watch_failure(branch_name, error)
	}
}

async function run_checks(input: {
	branch_name: string
	is_skip_watch: boolean
}): Promise<PrStateSnapshot> {
	if (!input.is_skip_watch) await watch_before_polling(input.branch_name)

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
	const comment_notes = await git_pr_coderabbit.handle_coderabbit_findings({
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
	WATCH_FAILED_NOTE,
	run_checks,
	build_issue_url,
	parse_repo_name,
	is_blank_issue_body,
	post_notify_issue,
	build_telegram_input,
	has_closes_keyword,
	warn_if_missing_closes,
}
export type { FollowupInput }
export type { TelegramContext } from './git-pr-ai-review'
