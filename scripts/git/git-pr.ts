import { animation_helpers, type AnimationOptions } from './animation-helpers'
import { git_conflict } from './git-conflict'
import { git_countdown } from './git-countdown'
import { git_gh_command } from './git-gh-command'
import type { IssueInfo } from './git-issue'
import { git_pr_error } from './git-pr-error'
import { git_pr_messages } from './git-pr-messages'

const WAIT_AFTER_PR_SECONDS = 5

async function create_pr(title: string, body: string): Promise<void> {
	const config: AnimationOptions<string> = {
		icon_selector: () => '✅',
		error_message: 'Failed to create PR',
		result_formatter: (message) => message,
	}

	try {
		await animation_helpers.execute_with_animation(
			'Creating pull request...',
			async () => {
				await git_gh_command.pr_create(title, body)

				return 'PR created.'
			},
			config,
		)
	} catch (error) {
		if (git_pr_error.is_pr_already_exists_error(error)) {
			git_pr_messages.display_pr_exists_message()

			return
		}

		throw error
	}
}

async function wait_before_check(): Promise<void> {
	await git_countdown.wait_for_seconds(
		WAIT_AFTER_PR_SECONDS,
		'⏳ Waiting before checking PR status',
	)
}

async function watch_pr_checks(branch_name: string): Promise<void> {
	console.info('')
	console.info('📊 Watching PR status checks...')
	console.info('')
	await git_gh_command.pr_checks_watch(branch_name)
}

async function display_pr_url_if_available(branch_name: string): Promise<void> {
	const pr_url = await git_gh_command.pr_get_url(branch_name)

	if (pr_url !== undefined) {
		git_pr_messages.display_pr_url(pr_url)
	}
}

async function handle_watch_error(branch_name: string, error: unknown): Promise<never> {
	await display_pr_url_if_available(branch_name)
	throw error
}

async function check_and_display_status(branch_name: string): Promise<void> {
	const has_errors = await git_conflict.check_pr_status_for_errors(branch_name)

	if (has_errors) {
		git_pr_messages.display_error_message()
	} else {
		git_pr_messages.display_success_message()
	}

	await display_pr_url_if_available(branch_name)
}

async function wait_and_check_status(branch_name: string): Promise<void> {
	await wait_before_check()

	try {
		await watch_pr_checks(branch_name)
	} catch (error) {
		await handle_watch_error(branch_name, error)
	}

	await check_and_display_status(branch_name)
}

const PR_STATE_MERGED = 'MERGED'

async function create_and_check_status(
	title: string,
	body: string,
	branch_name: string,
): Promise<void> {
	await create_pr(title, body)
	await wait_and_check_status(branch_name)
}

function parse_pr_state(pr_info_json: string): string | undefined {
	try {
		const pr_info = JSON.parse(pr_info_json) as Record<string, unknown>

		// eslint-disable-next-line dot-notation
		return (pr_info['state'] as string | undefined) ?? undefined
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
		await wait_and_check_status(branch_name)

		return
	}

	if (is_pr_state_merged(pr_state_result)) {
		git_pr_messages.display_merged_pr_message()
		await create_and_check_status(title, body, branch_name)

		return
	}

	await wait_and_check_status(branch_name)
}

async function create(title: string, body: string, branch_name: string): Promise<void> {
	const has_pr = await git_gh_command.pr_exists(branch_name)

	if (!has_pr) {
		await create_and_check_status(title, body, branch_name)

		return
	}

	await handle_existing_pr(title, body, branch_name)
}

function build_title(issue_info: IssueInfo): string {
	return `${issue_info.title} #${issue_info.number}`
}

function build_body(issue_info: IssueInfo): string {
	return `closes #${issue_info.number}`
}

async function create_with_issue_info(issue_info: IssueInfo): Promise<void> {
	const title = build_title(issue_info)
	const body = build_body(issue_info)

	await create(title, body, issue_info.branch_name)
}

const git_pr = {
	create,
	create_with_issue_info,
}

export { git_pr }
