import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { git_issue } from '#scripts/git/git-issue'
import { issue_cite } from '#scripts/issue/issue-cite'
import { session_cite } from '#scripts/issue/session-cite'

// The issue's branch an entry leaves a primary checkout on (joshuafolkken/kit#8983). `main:sync` stands
// the checkout on the default branch, where `review:selfcheck` and `preflight:check` both refuse, so the
// entry creates — or switches to — `<N>-<slug>` through the same `check_and_create_branch` `josh git -y`
// uses. A failure only warns: the run still reaches `josh git -y`, which creates the branch as before.

function warn(issue_number: string, reason: string): void {
	console.warn(
		session_cite.text(
			`(issue branch for ${session_cite.issue(issue_number)} not created — ${reason}; josh git -y creates it)`,
		),
	)
}

async function branch_name_of(issue_number: string): Promise<string | undefined> {
	const title = await git_gh_issue_read.issue_get_title(issue_number)

	if (title === undefined) return undefined

	return git_issue.parse(`${title} ${issue_cite.plain_for('github', issue_number)}`).branch_name
}

async function switch_to_issue_branch(issue_number: string): Promise<void> {
	const branch_name = await branch_name_of(issue_number)

	if (branch_name === undefined) {
		warn(issue_number, 'its title could not be read')

		return
	}

	try {
		await git_branch.check_and_create_branch(await git_command.branch(), branch_name)
	} catch (error: unknown) {
		warn(issue_number, error instanceof Error ? error.message : String(error))
	}
}

const run_entry_branch = {
	switch_to_issue_branch,
}

export { run_entry_branch }
