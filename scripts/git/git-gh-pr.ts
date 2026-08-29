import { git_command } from './git-command'
import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec, has_stderr_field } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import { forget_pr_numbers, git_gh_pr_read } from './git-gh-pr-read'

// The pull-request writes, plus the two reads the merge gate's own conversion still owns
// (`pr_checks` and `pr_get_state_snapshot`, joshuafolkken/kit#1028). Everything else here reads
// through REST and lives in `git-gh-pr-read.ts` (joshuafolkken/kit#1027).

async function pr_create(title: string, body: string): Promise<string> {
	const base = await git_command.get_default_branch()

	// A branch whose previous pull request merged gets a second one, so the branch → number
	// resolution the reads memoize is stale from here on. Clearing it is what keeps `pr_get_url`
	// from answering with the merged pull request afterwards.
	forget_pr_numbers()

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

async function pr_checkout(pr_number: number): Promise<void> {
	await git_gh_exec.exec_gh_command(['pr', 'checkout', String(pr_number)])
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
	...git_gh_pr_read,
	pr_create,
	pr_checks,
	pr_checkout,
	pr_get_state_snapshot,
	pr_comment,
	pr_merge,
}

export { git_gh_pr }
