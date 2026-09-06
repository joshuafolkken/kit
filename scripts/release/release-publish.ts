import { git_command } from '#scripts/git/git-command'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_pr_checks } from '#scripts/git/git-pr-checks'
import { write_version } from '#scripts/version/bump-version'
import { version_targets } from '#scripts/version/version-targets'
import type { ReleasePlan } from './release-plan'
import { release_tag } from './release-tag'

// The write half of `pnpm josh release`: the branch, the commit, the pull request, the merge and the
// wait for the tag (joshuafolkken/kit#1169).
//
// **The merge goes through the same gate every other pull request does.** `wait_for_pr_success` is
// the merge gate `pnpm josh followup` waits on, and it is called here rather than reimplemented —
// weakening it for a release commit would open exactly the "merge without green CI" path the issue's
// closing note prohibits.

const { PACKAGE_JSON } = version_targets
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

function branch_name_for(version: string): string {
	return `release/v${version}`
}

function commit_message(version: string): string {
	return `Release v${version}`
}

// **No `closes #N`.** A release carries whatever merged since the last one, so it closes no single
// issue; the mapping from issue to release is recovered from the merge commits between two tags,
// which is what `.github/release.yml` already classifies.
function pull_request_body(plan: ReleasePlan): string {
	return [
		`${String(plan.pending)} merge(s) have landed on main since \`${plan.base}\`, the commit that last changed the version.`,
		'',
		`Raising the version by that many minors: \`${plan.current_version}\` → \`${plan.next_version}\`.`,
		'',
		'Opened by `pnpm josh release` (joshuafolkken/kit#1169).',
	].join('\n')
}

// **A branch already there is a previous release attempt, not a name collision.** The wait for CI
// can throw — a timeout, a red required check, a `gh` failure — and the branch and its pull request
// survive it. Re-running then recomputes the same `pending`, so the branch name is identical and
// `git checkout -b` fails with git's own opaque message. Saying what is actually there leaves the
// person one decision rather than one diagnosis.
function existing_branch_message(branch_name: string): string {
	return `\`${branch_name}\` already exists — a previous release attempt got as far as opening it. Finish or delete that pull request and branch, then run \`pnpm josh release\` again.`
}

async function refuse_existing_branch(branch_name: string): Promise<void> {
	if (!(await git_command.branch_exists(branch_name))) return

	throw new Error(existing_branch_message(branch_name))
}

async function open_pull_request(plan: ReleasePlan): Promise<string> {
	const branch_name = branch_name_for(plan.next_version)

	await refuse_existing_branch(branch_name)
	await git_command.checkout_b(branch_name)
	write_version(plan.next_version)
	await git_command.add_path(PACKAGE_JSON)
	await git_command.commit(commit_message(plan.next_version))
	await git_command.push()
	console.info(
		await git_gh_command.pr_create(commit_message(plan.next_version), pull_request_body(plan)),
	)

	return branch_name
}

async function merge_and_tag(plan: ReleasePlan, branch_name: string): Promise<number> {
	await git_pr_checks.wait_for_pr_success(branch_name)
	await git_gh_command.pr_merge(branch_name)

	const is_tagged = await release_tag.wait_for_tag(plan.next_version)

	console.info(release_tag.format_result(plan.next_version, is_tagged))

	return is_tagged ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function return_to_default_branch(): Promise<void> {
	const default_branch = await git_command.get_default_branch()

	await git_command.checkout(default_branch)
	await git_command.pull()
}

// The checkout goes back to the default branch whichever way the wait ended, so a failed tag watch
// leaves the tree where the next command expects it rather than parked on the release branch.
async function publish(plan: ReleasePlan): Promise<number> {
	const branch_name = await open_pull_request(plan)

	try {
		return await merge_and_tag(plan, branch_name)
	} finally {
		await return_to_default_branch()
	}
}

const release_publish = {
	branch_name_for,
	commit_message,
	existing_branch_message,
	publish,
	pull_request_body,
	FAILURE_EXIT_CODE,
	SUCCESS_EXIT_CODE,
}

export { release_publish }
