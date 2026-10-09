import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_pr_ai_review, type TelegramContext } from '#scripts/gh/git-pr-ai-review'
import { git_pr_coderabbit } from '#scripts/gh/git-pr-coderabbit'
import { git_pr_managed_config } from '#scripts/gh/git-pr-managed-config'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import type { GitNotifyConfig } from '#scripts/notify/git-notify'
import {
	telegram_notify,
	type TelegramSendInput,
	type TelegramTaskType,
} from '#scripts/notify/telegram-notify'
import { git_followup_merged } from './git-followup-merged'
import { git_followup_pending } from './git-followup-pending'
import { git_followup_stages, type StageLog } from './git-followup-stages'
import { git_pr_followup_checks } from './git-pr-followup-checks'
import { git_pr_followup_wrapup } from './git-pr-followup-wrapup'

const { STAGE, lap } = git_followup_stages
const { run_checks, read_coderabbit_skip_notes, log_skip_notes } = git_pr_followup_checks

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
// a github.com URL looks like.
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
	// The pull request merged before this run: only the tail is left to run.
	is_merged?: boolean | undefined
	// When it merged — a completion report posted before it is the `prrun` stop's, not this tail's.
	merged_at?: string | undefined
}

const { parse_closes_issue_number } = git_closes_keyword

function has_closes_keyword(body: string | undefined): boolean {
	return parse_closes_issue_number(body) !== undefined
}

// **Returns the number it warned about the absence of**. Taking the issue number from the command
// line alone would make an invocation that omitted it throw after the merge had already landed. This
// stage reads the pull request body anyway, and that body
// carries the number in its `closes #N` keyword — so the read the warning already makes is what
// recovers it, at no extra request.
async function warn_if_missing_closes(branch_name: string): Promise<string | undefined> {
	const body = await git_gh_command.pr_get_body(branch_name)
	const closes_number = parse_closes_issue_number(body)

	if (closes_number !== undefined) return closes_number

	console.warn('')
	console.warn(
		'⚠️  PR body is missing a "closes #N" keyword — the linked Issue will not auto-close on merge.',
	)
	console.warn('   Recovery: pnpm josh pr  (or: pnpm josh git -y --skip-commit --skip-push)')
	console.warn('')

	return undefined
}

// **The one read of the four that can depend on another.** Without an issue number on the command
// line it is the pull request body that names it, so the title read waits
// for exactly that one and for nothing else. With a number in hand the `??` short-circuits and the
// promise is never awaited at all, which is what lets this read go out in the same tick as the other
// three.
async function read_issue_title(
	issue_number: string | undefined,
	closes_number: Promise<string | undefined>,
): Promise<string | undefined> {
	const number = issue_number ?? (await closes_number)
	if (number === undefined) return undefined

	return await git_gh_command.issue_get_title(number)
}

interface RunContext {
	issue_number: string | undefined
	closes_number: string | undefined
	context: TelegramContext
}

// **The four reads in front of the check wait are issued together**. Not one
// of them is a wait on anything: the `closes #N` check reads the pull request body, and the
// notification needs the repository name, the issue title and the pull request URL — four requests
// that were sent one at a time for 5.5 of `followup`'s measured 45.8 seconds, purely because they
// were written as consecutive statements.
//
// **This overlaps requests; it decides nothing differently.** The `closes #N` warning still fires on
// the same body, the context still carries the same four fields, and the required-check wait and the
// AI-review scan below — the merge gate itself — are untouched. Overlapping two reads that do not
// depend on each other is the whole of the change; skipping one would be a different thing entirely.
//
// **Every promise is handed to `Promise.all` in the same synchronous block**, so a rejection has a
// handler attached in the tick it was created — the first failure still ends the run, and no other
// read is left rejecting into nothing.
async function read_run_context(input: {
	branch_name: string
	issue_number: string | undefined
}): Promise<RunContext> {
	const closes = warn_if_missing_closes(input.branch_name)
	const [closes_number, name_with_owner, pr_url, issue_title] = await Promise.all([
		closes,
		git_gh_command.repo_get_name_with_owner(),
		git_gh_command.pr_get_url(input.branch_name),
		read_issue_title(input.issue_number, closes),
	])
	const issue_number = input.issue_number ?? closes_number

	return {
		issue_number,
		closes_number,
		context: {
			repo_name: parse_repo_name(name_with_owner),
			issue_title,
			issue_url: build_issue_url(pr_url, issue_number),
			pr_url,
		},
	}
}

// The pending count replaces the project version line: children no longer
// bump, so the local `package.json` names the previous release rather than what this run ships.
// A count that could not be read contributes no line at all, rather than a zero nobody measured.
async function notify_completion(
	context: TelegramContext,
	skip_notes: ReadonlyArray<string>,
	is_merge_pending: boolean,
): Promise<void> {
	const pending_line = await git_followup_pending.pending_release_line({ is_merge_pending })
	const lines = pending_line === undefined ? skip_notes : [pending_line, ...skip_notes]
	const body = lines.join('\n')

	// **The tolerant send**: this runs on the way to the merge, so a Telegram
	// gateway timeout must not leave a reviewed, green pull request unmerged. The failure is reported
	// under `❗` and the run carries on.
	//
	// **No recovery line**, deliberately, in the same sense `git_followup_cleanup`'s epic-close step
	// has none: a completion notification is never re-sent by hand — `pnpm josh notify --task-type
	// completion` is prohibited because it populates no PR link — and re-running `followup` after the
	// merge is not a re-send either. Naming either would send the reader somewhere useless.
	await telegram_notify.send_or_report(
		build_telegram_input({
			task_type: 'completion',
			context,
			body,
		}),
		undefined,
	)
}

// The two comment scans, marked separately from the check wait because they answer a different
// question: the wait is time GitHub took, and these are requests this command chose to make.
async function run_comment_scans(
	input: FollowupInput,
	context: TelegramContext,
	log: StageLog,
): Promise<Array<string>> {
	const comment_notes = await git_pr_coderabbit.handle_coderabbit_findings({
		branch_name: input.branch_name,
		ignore_reason: input.coderabbit_ignore_reason,
	})

	lap(log, STAGE.coderabbit_comments)
	const ai_review_notes = await git_pr_ai_review.handle_ai_review_findings({
		branch_name: input.branch_name,
		ignore_reason: input.ai_review_ignore_reason,
		context,
	})

	lap(log, STAGE.ai_review_comments)

	return [...comment_notes, ...ai_review_notes]
}

// **The managed config-file read runs first, ahead of the check wait**. It
// reads the branch diff and nothing else, so its answer is in hand before CI is waited on at all.
// That answer stops nothing — it is a report — but a read this cheap belongs beside the other things
// decided from the diff.
//
// **It laps no stage of its own.** The printed stage sequence is asserted as an exact list, and a
// diff read this cheap is not what a measurement of `followup` is looking for; its cost lands inside
// `checks-wait`, where it is indistinguishable from noise.
//
// **The managed report comes back beside the notes as well as inside them**, because the two have
// different destinations: every note reaches the completion notification, and this one alone also
// reaches the completion report posted to the Issue. Returning it twice is
// what lets `run_stages` hand each destination what belongs to it without re-deriving the answer.
async function run_review_checks(
	input: FollowupInput,
	context: TelegramContext,
	log: StageLog,
): Promise<{ notes: Array<string>; managed: Array<string> }> {
	if (input.is_merged === true) return { notes: [], managed: [] }

	const managed = await git_pr_managed_config.handle_managed_config_changes({
		should_merge: input.should_merge,
	})
	const snapshot = await run_checks({
		branch_name: input.branch_name,
		is_skip_watch: input.is_skip_watch,
	})

	lap(log, STAGE.checks_wait)
	const check_notes = read_coderabbit_skip_notes(snapshot)

	log_skip_notes(check_notes)
	const scan_notes = await run_comment_scans(input, context, log)

	return { notes: [...managed, ...check_notes, ...scan_notes], managed }
}

// **A tail re-run after a merge does not report twice**: where the issue
// already carries this pull request's completion report, the Telegram is skipped here and the comment
// in the wrapup. Answers whether it was recorded, so the wrapup skips on the same read.
async function notify_unless_recorded(
	input: FollowupInput,
	issue_number: string | undefined,
	context: TelegramContext,
	checks: { notes: Array<string> },
): Promise<boolean> {
	const is_recorded = await git_followup_merged.is_completion_recorded({
		merged_at: input.is_merged === true ? input.merged_at : undefined,
		issue_number,
		pr_url: context.pr_url,
	})

	if (!is_recorded) await notify_completion(context, checks.notes, input.should_merge)

	return is_recorded
}

// **Answers with the issue number the run actually used**, which is the one
// the invocation named or, failing that, the one the pull request body closes. Everything downstream
// takes it from here rather than from the input, so the Telegram context, the completion comment and
// the epic close all name the same issue — and so the caller's own tail can record a run whose number
// only the pull request knew.
async function run_stages(input: FollowupInput, log: StageLog): Promise<string | undefined> {
	const { issue_number, closes_number, context } = await read_run_context(input)

	lap(log, STAGE.closes_and_context)
	const checks = await run_review_checks(input, context, log)
	const is_completion_recorded = await notify_unless_recorded(input, issue_number, context, checks)

	lap(log, STAGE.telegram)
	await git_pr_followup_wrapup.run_wrapup(
		{
			branch_name: input.branch_name,
			issue_number,
			closes_number,
			notify_config: input.notify_config,
			pr_url: context.pr_url,
			should_merge: input.should_merge,
			managed_notes: checks.managed,
			is_merged: input.is_merged,
			is_completion_recorded,
		},
		log,
	)

	return issue_number
}

// **The stage block is printed on the way out of every run, failed ones included**.
// A `followup` that exits non-zero on an AI-review blocker or a red check is
// the invocation whose wait was longest, and one that printed nothing would leave the measurement
// blind to exactly those. The `catch` marks the lap that was still running so the failing stage is
// reported rather than dropped, and rethrows unchanged — a silent run is still a failed run.
async function run(input: FollowupInput): Promise<string | undefined> {
	const log = git_followup_stages.new_log()

	try {
		return await run_stages(input, log)
	} catch (error) {
		lap(log, git_followup_stages.stopped_lap(error))

		throw error
	} finally {
		git_followup_stages.print_stages(log)
	}
}

const git_pr_followup = {
	run,
}

export {
	git_pr_followup,
	run_checks,
	build_issue_url,
	parse_repo_name,
	build_telegram_input,
	has_closes_keyword,
	parse_closes_issue_number,
	warn_if_missing_closes,
	read_coderabbit_skip_notes,
	log_skip_notes,
}
export type { FollowupInput }
export type { TelegramContext } from '#scripts/gh/git-pr-ai-review'

export { WATCH_FAILED_NOTE } from './git-pr-followup-checks'
