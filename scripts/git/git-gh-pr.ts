import { git_command } from './git-command'
import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import { forget_pr_numbers, git_gh_pr_read } from './git-gh-pr-read'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'

// The pull-request writes. Every read here goes through REST now: the ones `gh pr view` served live
// in `git-gh-pr-read.ts` (joshuafolkken/kit#1027) and the merge gate's own snapshot in
// `git-gh-pr-snapshot.ts` (joshuafolkken/kit#1028).
//
// `pr_checks` — a `gh pr checks <branch>` wrapper — is gone rather than converted. Nothing called it:
// the merge gate reads the rollup out of the snapshot and `git-pr-checks-watch.ts` runs the watching
// variant, so rebuilding it on REST would have added a second, unread path to the same data.

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

async function pr_checkout(pr_number: number): Promise<void> {
	await git_gh_exec.exec_gh_command(['pr', 'checkout', String(pr_number)])
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
	...git_gh_pr_snapshot,
	pr_create,
	pr_checkout,
	pr_comment,
	pr_merge,
}

export { git_gh_pr }
