import { git_followup_pending } from './git-followup-pending'
import { git_followup_stages, type StageLog } from './git-followup-stages'
import { git_gh_command } from './git-gh-command'
import { git_gh_helpers } from './git-gh-helpers'
import type { GitNotifyConfig } from './git-notify'
import { git_pr_ai_review, type TelegramContext } from './git-pr-ai-review'
import { git_pr_checks } from './git-pr-checks'
import { is_coderabbit_check } from './git-pr-checks-eval'
import { CHECK_STATUS_PASS, git_pr_checks_parse, type PrStateSnapshot } from './git-pr-checks-parse'
import { git_pr_coderabbit } from './git-pr-coderabbit'
import { git_pr_followup_wrapup } from './git-pr-followup-wrapup'
import { git_pr_managed_config } from './git-pr-managed-config'
import { github_issue_url } from './github-issue-url'
import { telegram_notify, type TelegramSendInput, type TelegramTaskType } from './telegram-notify'

const { STAGE, lap } = git_followup_stages

// Captures the number, so the one pattern answers both questions the run asks of a PR body: whether
// the linked issue will auto-close, and — since joshuafolkken/kit#1539 — which issue that is when the
// invocation did not say. A second pattern here would be two readings of "closes #N" to disagree.
const CLOSES_PATTERN = /closes\s+#(\d+)/iu
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

function parse_closes_issue_number(body: string | undefined): string | undefined {
	if (body === undefined) return undefined

	return CLOSES_PATTERN.exec(body)?.[1]
}

function has_closes_keyword(body: string | undefined): boolean {
	return parse_closes_issue_number(body) !== undefined
}

// **Returns the number it warned about the absence of** (joshuafolkken/kit#1539). The issue number
// used to reach the notification from the command line alone, so an invocation that omitted it threw
// after the merge had already landed. This stage reads the pull request body anyway, and that body
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

// The skip is printed where the run is being watched, not only carried into the Telegram body it
// ends up in. A merge that went ahead while CodeRabbit had not come back is the one thing kit#753's
// exemption trades away, and it used to be invisible in `followup`'s own output
// (joshuafolkken/kit#1217).
function log_skip_notes(notes: ReadonlyArray<string>): void {
	for (const note of notes) {
		console.info(`⏭ ${note}`)
	}
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

// The pending count replaces the project version line (joshuafolkken/kit#1486): children no longer
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

	// **The tolerant send** (joshuafolkken/kit#1564): this runs on the way to the merge, so a Telegram
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

// **The managed config-file read runs first, ahead of the check wait** (joshuafolkken/kit#1578). It
// reads the branch diff and nothing else, so its answer is in hand before CI is waited on at all.
// Since joshuafolkken/kit#1592 that answer stops nothing — it is a report — but the position is kept:
// a read this cheap belongs beside the other things decided from the diff.
//
// **It laps no stage of its own.** The printed stage sequence is asserted as an exact list, and a
// diff read this cheap is not what a measurement of `followup` is looking for; its cost lands inside
// `checks-wait`, where it is indistinguishable from noise.
//
// **The managed report comes back beside the notes as well as inside them**, because the two have
// different destinations: every note reaches the completion notification, and this one alone also
// reaches the completion report posted to the Issue (joshuafolkken/kit#1592). Returning it twice is
// what lets `run_stages` hand each destination what belongs to it without re-deriving the answer.
async function run_review_checks(
	input: FollowupInput,
	context: TelegramContext,
	log: StageLog,
): Promise<{ notes: Array<string>; managed: Array<string> }> {
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

// **Answers with the issue number the run actually used** (joshuafolkken/kit#1539), which is the one
// the invocation named or, failing that, the one the pull request body closes. Everything downstream
// takes it from here rather than from the input, so the Telegram context, the completion comment and
// the epic close all name the same issue — and so the caller's own tail can record a run whose number
// only the pull request knew.
async function run_stages(input: FollowupInput, log: StageLog): Promise<string | undefined> {
	const closes_number = await warn_if_missing_closes(input.branch_name)
	const issue_number = input.issue_number ?? closes_number

	lap(log, STAGE.closes_check)
	const context = await fetch_telegram_context({ branch_name: input.branch_name, issue_number })

	lap(log, STAGE.context)
	const checks = await run_review_checks(input, context, log)

	await notify_completion(context, checks.notes, input.should_merge)

	lap(log, STAGE.telegram)
	await git_pr_followup_wrapup.run_wrapup(
		{
			branch_name: input.branch_name,
			issue_number,
			notify_config: input.notify_config,
			pr_url: context.pr_url,
			should_merge: input.should_merge,
			managed_notes: checks.managed,
		},
		log,
	)

	return issue_number
}

// **The stage block is printed on the way out of every run, failed ones included**
// (joshuafolkken/kit#1349). A `followup` that exits non-zero on an AI-review blocker or a red check is
// the invocation whose wait was longest, and one that printed nothing would leave the measurement
// blind to exactly those. The `catch` marks the lap that was still running so the failing stage is
// reported rather than dropped, and rethrows unchanged — a silent run is still a failed run.
async function run(input: FollowupInput): Promise<string | undefined> {
	const log = git_followup_stages.new_log()

	try {
		return await run_stages(input, log)
	} catch (error) {
		lap(log, STAGE.interrupted)

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
	WATCH_FAILED_NOTE,
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
export type { TelegramContext } from './git-pr-ai-review'
