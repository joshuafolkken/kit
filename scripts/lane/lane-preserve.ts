import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_stash } from '#scripts/git/stash/git-stash'

// Keeping a lane's uncommitted work before something discards or restarts it — `run:merge` closing a
// lane, `lane:restart` handing it to a fresh session. The stash stack outlives the tree, so the push is
// the copy, and the comment on the Issue is where a person finds it again. One writer, so the message
// `stash:pop` matches on and the recovery line the comment names cannot drift between the callers.

function preserved_comment(message: string, cause: string): string {
	return [
		`The lane held uncommitted work when ${cause}, so it was stashed:`,
		`- recover with \`pnpm josh stash:pop "${message}"\``,
	].join('\n')
}

/**
 * Push the lane's uncommitted work under `<issue>: uncommitted work at <occasion>`, and return the
 * message. A push that fails throws, so the caller keeps the tree rather than losing it.
 */
async function push_work(issue: string, directory: string, occasion: string): Promise<string> {
	const message = git_stash.work_message(issue, occasion)

	await git_stash.push(message, directory)

	return message
}

/** Say on the Issue where the stash `message` went, `cause` completing "when …". Never throws. */
async function announce(issue: string, message: string, cause: string): Promise<void> {
	await git_gh_issue_write.issue_try_comment(issue, preserved_comment(message, cause))
}

/** `push_work`, then `announce` — for a caller with no reason to separate the two. */
async function stash_work(
	issue: string,
	directory: string,
	occasion: string,
	cause: string,
): Promise<string> {
	const message = await push_work(issue, directory, occasion)

	await announce(issue, message, cause)

	return message
}

const lane_preserve = { announce, push_work, stash_work }

export { lane_preserve }
