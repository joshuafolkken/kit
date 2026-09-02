import { animation_helpers, type AnimationOptions } from './animation-helpers'
import { git_gh_command } from './git-gh-command'
import type { IssueInfo } from './git-issue'
import { git_pr_error } from './git-pr-error'
import { git_pr_messages } from './git-pr-messages'
import { pr_info_schema } from './schemas'

// **Answers the new pull request's URL, and `undefined` when one already existed.** `pr_create`
// filters its REST response to `.html_url`, so the address is in hand the moment the call returns —
// which matters now that nothing waits before reporting it (joshuafolkken/kit#1232). `pr_get_url`
// resolves the branch through the `?head=…` listing, and that listing is eventually consistent: read
// in the same instant the pull request was created it can answer nothing, and `pr_get_url` folds
// "not there yet" and "the read failed" into the same `undefined`. The five-second sleep used to
// cover that gap incidentally.
async function create_pr(title: string, body: string): Promise<string | undefined> {
	const config: AnimationOptions<string> = {
		icon_selector: () => '✅',
		error_message: 'Failed to create PR',
		result_formatter: () => 'PR created.',
	}

	try {
		return await animation_helpers.execute_with_animation(
			'Creating pull request...',
			async () => await git_gh_command.pr_create(title, body),
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

// **This command stops at "the pull request is open"; it does not wait for the checks**
// (joshuafolkken/kit#1232). It used to sleep five seconds and then watch the rollup on a two-minute
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

async function create_and_report(title: string, body: string, branch_name: string): Promise<void> {
	const created_url = await create_pr(title, body)

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

async function get_pr_state_safe(branch_name: string): Promise<string | undefined> {
	try {
		const pr_info_json = await git_gh_command.pr_view(branch_name)

		if (pr_info_json.length === 0) {
			return undefined
		}

		return parse_pr_state(pr_info_json)
	} catch {
		return undefined
	}
}

function is_pr_state_merged(pr_state: string | undefined): boolean {
	return pr_state === PR_STATE_MERGED
}

function is_pr_state_undefined(pr_state: string | undefined): boolean {
	return pr_state === undefined
}

async function handle_existing_pr(title: string, body: string, branch_name: string): Promise<void> {
	const pr_state_result = await get_pr_state_safe(branch_name)

	if (is_pr_state_undefined(pr_state_result)) {
		await report_open_pr(branch_name)

		return
	}

	if (is_pr_state_merged(pr_state_result)) {
		git_pr_messages.display_merged_pr_message()
		await create_and_report(title, body, branch_name)

		return
	}

	await report_open_pr(branch_name)
}

async function create(title: string, body: string, branch_name: string): Promise<void> {
	const has_pr = await git_gh_command.pr_exists(branch_name)

	if (!has_pr) {
		await create_and_report(title, body, branch_name)

		return
	}

	await handle_existing_pr(title, body, branch_name)
}

function build_title(issue_info: IssueInfo): string {
	return `${issue_info.title} #${issue_info.number}`
}

function build_body(issue_info: IssueInfo, extra_body?: string): string {
	const closes = `closes #${issue_info.number}`

	if (extra_body === undefined) return closes

	return `${closes}\n\n${extra_body}`
}

async function create_with_issue_info(issue_info: IssueInfo, extra_body?: string): Promise<void> {
	const title = build_title(issue_info)
	const body = build_body(issue_info, extra_body)

	await create(title, body, issue_info.branch_name)
}

const git_pr = {
	create,
	create_with_issue_info,
}

export { git_pr }
