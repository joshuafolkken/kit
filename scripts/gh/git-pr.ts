import { pr_classification, type ReleaseClassification } from '#scripts/ci/pr-classification'
import type { IssueInfo } from '#scripts/git/git-issue'
import { pr_info_schema } from '#scripts/git/git-schemas'
import { issue_cite } from '#scripts/issue/issue-cite'
import { session_cite } from '#scripts/issue/session-cite'
import { animation_helpers, type AnimationOptions } from '#scripts/lib/animation-helpers'
import { git_gh_command } from './git-gh-command'
import { git_pr_error } from './git-pr-error'
import { git_pr_messages } from './git-pr-messages'

// **Answers the new pull request's URL, and `undefined` when one already existed.** `pr_create`
// filters its REST response to `.html_url`, so the address is in hand the moment the call returns —
// which matters now that nothing waits before reporting it. `pr_get_url`
// resolves the branch through the `?head=…` listing, and that listing is eventually consistent: read
// in the same instant the pull request was created it can answer nothing, and `pr_get_url` folds
// "not there yet" and "the read failed" into the same `undefined`. The five-second sleep used to
// cover that gap incidentally.
async function create_pr(
	title: string,
	body: string,
	label: ReleaseClassification,
): Promise<string | undefined> {
	const config: AnimationOptions<string> = {
		icon_selector: () => '✅',
		error_message: 'Failed to create PR',
		result_formatter: () => 'PR created.',
	}

	try {
		return await animation_helpers.execute_with_animation(
			'Creating pull request...',
			async () => await git_gh_command.pr_create(title, body, label),
			config,
		)
	} catch (error) {
		if (git_pr_error.is_pr_already_exists_error(error)) {
			git_pr_messages.display_pr_exists_message()

			return undefined
		}

		throw error
	}
}

async function display_pr_url_if_available(branch_name: string): Promise<void> {
	const pr_url = await git_gh_command.pr_get_url(branch_name)

	if (pr_url !== undefined) {
		git_pr_messages.display_pr_url(pr_url)
	}
}

// **This command stops at "the pull request is open"; it does not wait for the checks**.
// It used to sleep five seconds and then watch the rollup on a two-minute
// budget — measured at 119.8 seconds of one 1555-second run, 7.7% of it — and the answer decided
// nothing: only `timed_out` was read, and only to pick which message to print. What actually blocks
// a merge is `pnpm josh followup`, whose `wait_for_pr_success` asks a stricter question (CLEAN merge
// state, every required check green, no standing change request) and starts that wait from scratch
// the moment this command returns. So the wait here was the same answer, paid for twice.
//
// **The conflict read went with it, and its replacement is not here.** `git-conflict.ts` read
// `mergeStateStatus` right after the watch reported the checks settled, where `BLOCKED` genuinely
// meant something. Called at *this* point it would fire on every healthy pull request instead:
// GitHub reports `BLOCKED` as soon as a required check is queued. The conflict is caught in
// `git-pr-checks-eval.ts` now, where `DIRTY` ends the wait on its first poll — about ten seconds,
// against the two minutes this watch took to reach the same conclusion.
async function report_open_pr(branch_name: string, created_url?: string): Promise<void> {
	git_pr_messages.display_pr_opened_message()

	if (created_url !== undefined && created_url.length > 0) {
		git_pr_messages.display_pr_url(created_url)

		return
	}

	await display_pr_url_if_available(branch_name)
}

const PR_STATE_MERGED = 'MERGED'

async function create_and_report(
	title: string,
	body: string,
	branch_name: string,
	label: ReleaseClassification,
): Promise<void> {
	const created_url = await create_pr(title, body, label)

	await report_open_pr(branch_name, created_url)
}

function parse_pr_state(pr_info_json: string): string | undefined {
	try {
		const result = pr_info_schema.safeParse(JSON.parse(pr_info_json))

		return result.success ? result.data.state : undefined
	} catch {
		return undefined
	}
}

// A read that failed throws rather than answering `undefined`: "no state" is read as "not merged",
// which would write onto a pull request that already merged.
async function get_pr_state(branch_name: string): Promise<string | undefined> {
	const pr_info_json = await git_gh_command.pr_view(branch_name)

	if (pr_info_json.length === 0) return undefined

	return parse_pr_state(pr_info_json)
}

function is_pr_state_merged(pr_state: string | undefined): boolean {
	return pr_state === PR_STATE_MERGED
}

// A body the caller supplied is written onto the pull request that is already open, rather than
// dropped with the create that did not happen: a rerun carrying the
// live-execution evidence is how a merge `followup` refused for lacking it is recovered.
async function report_existing_pr(
	body: string,
	branch_name: string,
	should_replace_body: boolean,
	label: ReleaseClassification,
): Promise<void> {
	await git_gh_command.pr_ensure_classification(branch_name, label)
	if (should_replace_body) await git_gh_command.pr_update_body(branch_name, body)

	await report_open_pr(branch_name)
}

async function handle_existing_pr(
	title: string,
	body: string,
	branch_name: string,
	options: { label: ReleaseClassification; should_replace_body: boolean },
): Promise<void> {
	const pr_state_result = await get_pr_state(branch_name)

	if (is_pr_state_merged(pr_state_result)) {
		git_pr_messages.display_merged_pr_message()
		await create_and_report(title, body, branch_name, options.label)

		return
	}

	await report_existing_pr(body, branch_name, options.should_replace_body, options.label)
}

async function create(
	title: string,
	body: string,
	branch_name: string,
	options: { label: ReleaseClassification; should_replace_body?: boolean },
): Promise<void> {
	const { label, should_replace_body = false } = options
	const has_pr = await git_gh_command.pr_exists(branch_name)

	if (!has_pr) {
		await create_and_report(title, body, branch_name, label)

		return
	}

	await handle_existing_pr(title, body, branch_name, { label, should_replace_body })
}

function build_title(issue_info: IssueInfo): string {
	return `${issue_info.title} ${issue_cite.plain(issue_info.number)}`
}

function build_body(issue_info: IssueInfo, extra_body?: string): string {
	const closes = `closes ${issue_cite.plain(issue_info.number)}`

	if (extra_body === undefined) return closes

	return `${closes}\n\n${extra_body}`
}

async function existing_pr_label(branch_name: string): Promise<ReleaseClassification | undefined> {
	if (!(await git_gh_command.pr_exists(branch_name))) return undefined
	if (is_pr_state_merged(await get_pr_state(branch_name))) return undefined

	return await git_gh_command.pr_get_classification(branch_name)
}

async function create_for_issue(
	issue_info: IssueInfo,
	extra_body: string | undefined,
	label: ReleaseClassification,
): Promise<void> {
	await create(
		build_title(issue_info),
		build_body(issue_info, extra_body),
		issue_info.branch_name,
		{
			label,
			should_replace_body: extra_body !== undefined,
		},
	)
}

// The label the pull request is opened with — also asked by `git-preflight.ts` before the commit, so
// a missing classification is reported beside the other unmet preconditions.
async function release_classification(
	issue_number: string,
	branch_name: string,
): Promise<ReleaseClassification> {
	const existing_label = await existing_pr_label(branch_name)

	if (existing_label !== undefined) return existing_label

	const issue_json = await git_gh_command.issue_view_json(issue_number, 'labels,body')

	if (issue_json === undefined) {
		throw new Error(
			`Could not read issue ${session_cite.issue(issue_number)} for release classification`,
		)
	}

	return pr_classification.select_issue_classification(issue_json)
}

async function create_with_issue_info(issue_info: IssueInfo, extra_body?: string): Promise<void> {
	const label = await release_classification(issue_info.number, issue_info.branch_name)

	await create_for_issue(issue_info, extra_body, label)
}

const git_pr = {
	create,
	create_with_issue_info,
	release_classification,
}

export { git_pr }
