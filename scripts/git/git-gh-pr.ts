import { git_command } from './git-command'
import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec, has_stderr_field } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import { git_gh_repo } from './git-gh-repo'

async function pr_create(title: string, body: string): Promise<string> {
	const base = await git_command.get_default_branch()

	try {
		return await git_gh_exec.exec_gh_command([
			'pr',
			'create',
			'--title',
			title,
			'--body',
			body,
			'--base',
			base,
		])
	} catch (error) {
		return git_gh_helpers.handle_pr_create_error(error)
	}
}

async function pr_checks(branch_name: string): Promise<string> {
	try {
		return await git_gh_exec.exec_gh_command(['pr', 'checks', branch_name])
	} catch (error) {
		if (has_stderr_field(error) && error.stderr.length > 0) {
			throw new Error(error.stderr, { cause: error })
		}

		throw error
	}
}

async function pr_exists(branch_name: string): Promise<boolean> {
	try {
		await git_gh_exec.exec_gh_command(['pr', 'view', branch_name])

		return true
	} catch {
		return false
	}
}

async function pr_view(branch_name: string): Promise<string> {
	try {
		return await git_gh_exec.exec_gh_command([
			'pr',
			'view',
			branch_name,
			'--json',
			'mergeable,mergeStateStatus,state',
			'--jq',
			'.',
		])
	} catch {
		return ''
	}
}

async function pr_get_url(branch_name: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command([
			'pr',
			'view',
			branch_name,
			'--json',
			'url',
			'--jq',
			'.url',
		])

		return git_gh_helpers.parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

async function pr_get_body(branch_name: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command([
			'pr',
			'view',
			branch_name,
			'--json',
			'body',
			'--jq',
			'.body',
		])

		return result.length > 0 ? result : undefined
	} catch {
		return undefined
	}
}

async function pr_get_number(branch_name: string): Promise<number | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command([
			'pr',
			'view',
			branch_name,
			'--json',
			'number',
			'--jq',
			'.number',
		])

		return git_gh_helpers.parse_number_output(result)
	} catch {
		return undefined
	}
}

async function pr_get_state_snapshot(branch_name: string): Promise<string> {
	return await git_gh_exec.exec_gh_command([
		'pr',
		'view',
		branch_name,
		'--json',
		'mergeStateStatus,reviewDecision,statusCheckRollup',
	])
}

async function pr_get_review_comments(branch_name: string): Promise<string> {
	const repo_name = await git_gh_repo.repo_get_name_with_owner()
	const pr_number = await pr_get_number(branch_name)
	if (repo_name === undefined || pr_number === undefined) return '[]'

	try {
		return await git_gh_exec.exec_gh_command([
			'api',
			`repos/${repo_name}/pulls/${String(pr_number)}/comments`,
		])
	} catch {
		return '[]'
	}
}

async function pr_get_comments(branch_name: string): Promise<string> {
	try {
		return await git_gh_exec.exec_gh_command([
			'pr',
			'view',
			branch_name,
			'--json',
			'comments',
			'--jq',
			'.comments',
		])
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
	await git_gh_exec.exec_gh_command(['pr', 'merge', branch_name, '--merge'])
}

const git_gh_pr = {
	pr_create,
	pr_checks,
	pr_exists,
	pr_view,
	pr_get_url,
	pr_get_body,
	pr_get_number,
	pr_get_state_snapshot,
	pr_get_review_comments,
	pr_get_comments,
	pr_comment,
	pr_merge,
}

export { git_gh_pr }
