import { gh_spawn } from '#scripts/gh/gh-spawn'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { PLAN_UNVERIFIED_LABEL } from '#scripts/issue/issue-labels'

// joshuafolkken/kit#7733: `issue:plan --planned --repo <owner/name>` run from another repository's
// checkout wrote an estimate `plan:consumers` read from the wrong tree, and `run:planned` made it
// runnable unchecked (#7695: declared 6 files, landed 30). Such a plan is held as `plan:unverified`
// until it is re-planned from the target's checkout.

// The `--repo` target when it is a repository other than the working checkout's. An unreadable
// checkout counts as another repository, so an unverified estimate is never marked runnable.
function foreign_of(repo: string | undefined): string | undefined {
	if (repo === undefined) return undefined
	const checkout = gh_spawn.get_repo_name_with_owner()

	return repo.toLowerCase() === checkout?.toLowerCase() ? undefined : repo
}

// Labels the issue `plan:unverified` and prints the re-plan that makes it runnable.
async function mark_unverified(issue_number: string, repo: string): Promise<boolean> {
	const is_applied = await git_gh_command.issue_add_label(issue_number, PLAN_UNVERIFIED_LABEL, repo)

	if (is_applied) {
		console.info(`label: ${PLAN_UNVERIFIED_LABEL} — the estimate was not read from ${repo}'s tree`)
	} else {
		console.error(`Could not apply ${PLAN_UNVERIFIED_LABEL} to issue ${issue_number}.`)
	}

	console.info(
		`Re-plan from a ${repo} checkout: pnpm josh issue:plan ${issue_number} --body-file <plan> --planned`,
	)

	return is_applied
}

// A plan from the target's checkout drops an earlier `plan:unverified`; an absent label is no failure.
// A label left on would keep the issue out of every pickup, so a failed removal is reported.
async function clear_unverified(issue_number: string, repo: string | undefined): Promise<boolean> {
	const is_cleared = await git_gh_command.issue_clear_label(
		issue_number,
		PLAN_UNVERIFIED_LABEL,
		repo,
	)

	if (!is_cleared) {
		console.error(`Could not remove ${PLAN_UNVERIFIED_LABEL} from issue ${issue_number}.`)
	}

	return is_cleared
}

const issue_plan_target = { foreign_of, mark_unverified, clear_unverified }

export { issue_plan_target }
