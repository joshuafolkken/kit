import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_pr_checks } from '#scripts/gh/git-pr-checks'
import { git_command } from '#scripts/git/git-command'
import { git_remote_branch } from '#scripts/git/git-remote-branch'
import { repository_lock } from '#scripts/git/repository-lock'
import { write_version } from '#scripts/version/bump-version'
import { version_targets } from '#scripts/version/version-targets'
import type { ReleasePlan } from './release-plan'
import { release_progress } from './release-progress'
import { release_tag } from './release-tag'
import { release_worktree } from './release-worktree'

// The write half of `pnpm josh release`: the branch, the commit, the pull request, the merge, the
// wait for the tag and the watch on what the tag publishes (`release-progress.ts`).
//
// **The merge goes through the same gate every other pull request does.** `wait_for_pr_success` is
// the merge gate `pnpm josh followup` waits on, and it is called here rather than reimplemented —
// weakening it for a release commit would open exactly the "merge without green CI" path the issue's
// closing note prohibits.

const { PACKAGE_JSON } = version_targets
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const IGNORE_FOR_RELEASE_LABEL = 'ignore-for-release'
const RELEASE_LOCK_PREFIX = 'josh-release-lock-'
// A release waits on CI for minutes, so a second run refuses rather than queueing behind it.
const RELEASE_LOCK_MAX_WAIT_MS = 0

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

// **A remote that cannot be asked is refused, not read as "no branch there"**.
// `pnpm josh release` pushes, opens a pull request, merges it and waits for a tag, so it cannot
// finish without the remote in any case: refusing here is the failure the run was going to have
// anyway, moved in front of the version write and the commit — which is the whole point of this
// guard. Silently answering "not taken" instead would put the raw error back after two writes.
function unreachable_remote_message(branch_name: string): string {
	return `Could not ask origin whether \`${branch_name}\` already exists, so \`pnpm josh release\` stops before writing the version. It needs the remote to push, open the pull request and merge it. Restore the connection and run \`pnpm josh release\` again.`
}

// **The remote is asked as well as the local branch.** A previous attempt pushed before it opened
// the pull request, so deleting the local branch — or retrying from a second checkout — leaves the
// remote one standing on its own. Checking only locally there lets the run write the version, commit
// it and reach `push`, which then fails with git's non-fast-forward message: the raw error this
// guard exists to replace, and now after two writes rather than before them.
//
// **`git branch --list --remotes` cannot answer it, which is why origin is asked directly.** Its
// short names carry the remote — `origin/x`, never `x` — so an unprefixed pattern matches nothing and
// reports "absent" for every branch that has ever existed. The
// remote-tracking refs it reads are stale anyway, since nothing in this workflow prunes them, so
// `git_remote_branch.ask` puts the question to origin itself.
async function is_release_branch_taken(branch_name: string): Promise<boolean> {
	if (await git_command.branch_exists(branch_name)) return true

	const answer = await git_remote_branch.ask(branch_name)

	if (answer === 'unreachable') throw new Error(unreachable_remote_message(branch_name))

	return answer === 'present'
}

async function refuse_existing_branch(branch_name: string): Promise<void> {
	if (!(await is_release_branch_taken(branch_name))) return

	throw new Error(existing_branch_message(branch_name))
}

// **The leftovers go before the guard asks**. A run cut off before its
// `finally`, or a `worktree add` that failed after creating its branch, leaves a local
// `release/v<version>` that the guard would otherwise refuse as a release already opened.
async function clear_the_way(branch_name: string): Promise<void> {
	await release_worktree.clear_leftover()
	await refuse_existing_branch(branch_name)
}

// **No `checkout -b` and no branch guard here**. The work tree is already
// sitting on the release branch — `release_worktree.create` cut it that way — and the guard ran
// before that creation, because `worktree_add` makes the branch local and `branch_exists` would then
// report every release as already taken. This runs after `process.chdir` into the work tree, so the
// version write and the git commands all act on it rather than on the root.
async function commit_release(plan: ReleasePlan): Promise<string> {
	write_version(plan.next_version)
	await git_command.add_path(PACKAGE_JSON)
	await git_command.commit(commit_message(plan.next_version))
	await git_command.push()
	const pr_url = await git_gh_command.pr_create(
		commit_message(plan.next_version),
		pull_request_body(plan),
		IGNORE_FOR_RELEASE_LABEL,
	)

	console.info(release_progress.pr_opened_line(pr_url))

	return pr_url
}

// No tag means nothing downstream ran, so the npm and GitHub Release watches are not started.
async function merge_and_tag(
	plan: ReleasePlan,
	branch_name: string,
	pr_url: string,
): Promise<number> {
	await git_pr_checks.wait_for_pr_success(branch_name)
	await git_gh_command.pr_merge(branch_name)
	console.info(release_progress.pr_merged_line(pr_url))

	const is_tagged = await release_tag.wait_for_tag(plan.next_version)

	console.info(release_tag.format_result(plan.next_version, is_tagged))
	if (!is_tagged) return FAILURE_EXIT_CODE

	return await release_progress.wait_for_distribution(plan.next_version)
}

// The whole release happens inside a work tree cut for it, so the root checkout is never touched: the
// branch guard runs before the tree exists, `process.chdir` points the version write and the git
// commands at the tree, and the `finally` returns to the root and removes the tree — whichever way
// the wait ended, so a failed tag watch cleans up rather than leaving debris behind.
async function publish_locked(plan: ReleasePlan): Promise<number> {
	const branch_name = branch_name_for(plan.next_version)

	await clear_the_way(branch_name)

	const directory = await release_worktree.create(branch_name)
	const previous_cwd = process.cwd()

	try {
		process.chdir(directory)
		const pr_url = await commit_release(plan)

		return await merge_and_tag(plan, branch_name, pr_url)
	} finally {
		process.chdir(previous_cwd)
		await release_worktree.remove(directory, branch_name)
	}
}

function release_running_message(target: string): string {
	return `Another \`pnpm josh release\` is running in this repository (lock \`${target}\`); wait for it to finish, then run it again.`
}

// **One release at a time per repository, held for the whole run**.
// `clear_leftover` removes an unpushed, commit-less release branch, which is also what a live run
// looks like while it installs dependencies — so it may only run once no other release is alive. The
// lock answers that: a run cut off before its `finally` leaves a record whose owner is gone, which
// `repository_lock` clears on the next claim, while a live owner makes this run refuse at once.
async function publish(plan: ReleasePlan): Promise<number> {
	const target = repository_lock.lock_path(RELEASE_LOCK_PREFIX)
	const exit_code = await repository_lock.with_lock(
		async () => await publish_locked(plan),
		target,
		RELEASE_LOCK_MAX_WAIT_MS,
	)

	if (exit_code === undefined) throw new Error(release_running_message(target))

	return exit_code
}

const release_publish = {
	branch_name_for,
	commit_message,
	existing_branch_message,
	// Exported so the three answers the guard has to separate — here, on origin, on neither — are
	// asserted directly rather than through `publish`, whose next step writes `package.json`.
	is_release_branch_taken,
	publish,
	pull_request_body,
	unreachable_remote_message,
	SUCCESS_EXIT_CODE,
}

export { release_publish }
