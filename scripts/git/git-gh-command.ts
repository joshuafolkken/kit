import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec } from './git-gh-exec'
import { git_pr_checks_watch } from './git-pr-checks-watch'

function is_pr_already_exists_message(error_message: string): boolean {
	return error_message.toLowerCase().includes('already exists')
}

function get_error_message_with_stderr(error: unknown): string {
	if (error instanceof Error) {
		const exec_error = error as { stderr?: string }

		if (exec_error.stderr !== undefined && exec_error.stderr.length > 0) {
			return `${error.message}\n${exec_error.stderr}`
		}

		return error.message
	}

	return String(error)
}

function handle_pr_create_error(error: unknown): never {
	const error_message = get_error_message_with_stderr(error)

	if (is_pr_already_exists_message(error_message)) {
		throw new Error('PR_ALREADY_EXISTS')
	}

	throw error
}

async function pr_create(title: string, body: string): Promise<string> {
	const safe_title = JSON.stringify(title)
	const safe_body = JSON.stringify(body)

	try {
		return await git_gh_exec.exec_gh_command(
			`pr create --title ${safe_title} --body ${safe_body} --label enhancement --base main`,
		)
	} catch (error) {
		return handle_pr_create_error(error)
	}
}

async function pr_checks(branch_name: string): Promise<string> {
	try {
		return await git_gh_exec.exec_gh_command(`pr checks ${branch_name}`)
	} catch (error) {
		const exec_error = error as { stderr?: string; stdout?: string }

		if (exec_error.stderr !== undefined && exec_error.stderr.length > 0) {
			throw new Error(exec_error.stderr, { cause: error })
		}

		throw error
	}
}

async function pr_exists(branch_name: string): Promise<boolean> {
	try {
		await git_gh_exec.exec_gh_command(`pr view ${branch_name}`)

		return true
	} catch {
		return false
	}
}

async function pr_view(branch_name: string): Promise<string> {
	try {
		return await git_gh_exec.exec_gh_command(
			`pr view ${branch_name} --json mergeable,mergeStateStatus,state --jq .`,
		)
	} catch {
		return ''
	}
}

function parse_pr_state_string(result: string): string | undefined {
	const trimmed = result.trim()

	if (trimmed.length === 0) {
		return undefined
	}

	const without_quotes = trimmed.replaceAll(/(?:^")|(?:"$)/gu, '')

	return without_quotes.length > 0 ? without_quotes : undefined
}

async function pr_get_url(branch_name: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command(
			`pr view ${branch_name} --json url --jq .url`,
		)

		return parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

function parse_number_output(result: string): number | undefined {
	const parsed = Number(result.trim())
	if (!Number.isFinite(parsed)) return undefined

	return parsed
}

async function pr_get_state(branch_name: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command(
			`pr view ${branch_name} --json state --jq .state`,
		)

		return parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

async function pr_get_number(branch_name: string): Promise<number | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command(
			`pr view ${branch_name} --json number --jq .number`,
		)

		return parse_number_output(result)
	} catch {
		return undefined
	}
}

async function pr_get_state_snapshot(branch_name: string): Promise<string> {
	return await git_gh_exec.exec_gh_command(
		`pr view ${branch_name} --json mergeStateStatus,reviewDecision,statusCheckRollup`,
	)
}

async function issue_get_title(issue_number: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command(
			`issue view ${issue_number} --json title --jq .title`,
		)

		return parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

async function repo_get_name_with_owner(): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command(
			'repo view --json nameWithOwner --jq .nameWithOwner',
		)

		return parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

async function pr_get_review_comments(branch_name: string): Promise<string> {
	const repo_name = await repo_get_name_with_owner()
	const pr_number = await pr_get_number(branch_name)
	if (repo_name === undefined || pr_number === undefined) return '[]'

	try {
		return await git_gh_exec.exec_gh_command(
			`api repos/${repo_name}/pulls/${String(pr_number)}/comments`,
		)
	} catch {
		return '[]'
	}
}

async function pr_get_comments(branch_name: string): Promise<string> {
	try {
		return await git_gh_exec.exec_gh_command(
			`pr view ${branch_name} --json comments --jq .comments`,
		)
	} catch {
		return '[]'
	}
}

async function pr_comment(branch_name: string, body: string): Promise<string> {
	return await git_gh_exec.exec_gh_command_with_stdin({
		args: ['pr', 'comment', branch_name, BODY_FILE_FLAG, BODY_FROM_STDIN],
		stdin_body: body,
	})
}

async function pr_merge(branch_name: string): Promise<void> {
	await git_gh_exec.exec_gh_command(`pr merge ${branch_name} --merge`)
}

async function issue_get_body(issue_number: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command(
			`issue view ${issue_number} --json body --jq .body`,
		)

		return result
	} catch {
		return undefined
	}
}

async function issue_edit_body(issue_number: string, body: string): Promise<string> {
	return await git_gh_exec.exec_gh_command_with_stdin({
		args: ['issue', 'edit', issue_number, BODY_FILE_FLAG, BODY_FROM_STDIN],
		stdin_body: body,
	})
}

async function issue_comment(issue_number: string, body: string): Promise<string> {
	return await git_gh_exec.exec_gh_command_with_stdin({
		args: ['issue', 'comment', issue_number, BODY_FILE_FLAG, BODY_FROM_STDIN],
		stdin_body: body,
	})
}

const git_gh_command = {
	pr_create,
	pr_checks,
	pr_checks_watch: git_pr_checks_watch.pr_checks_watch,
	pr_exists,
	pr_view,
	pr_get_state,
	pr_get_url,
	pr_get_number,
	pr_get_state_snapshot,
	issue_get_title,
	issue_get_body,
	issue_edit_body,
	repo_get_name_with_owner,
	pr_get_review_comments,
	pr_get_comments,
	pr_comment,
	pr_merge,
	issue_comment,
}

export { git_gh_command, parse_pr_state_string }
export { PR_CHECKS_WATCH_TIMEOUT_MS } from './git-pr-checks-watch'
