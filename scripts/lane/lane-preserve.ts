import { existsSync } from 'node:fs'
import path from 'node:path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { repository_lock } from '#scripts/git/repository-lock'
import { git_stash } from '#scripts/git/stash/git-stash'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { lane_close } from './lane-close'

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

// The tree's work kept before a stopped child's lane is reused or closed: `saved` with the stash, or
// none for a clean tree, and `unsaved` with the reason when the tree could not be read or pushed — the
// caller then leaves the tree as it is rather than handing it on or deleting it.
type KeptWork =
	| { kind: 'saved'; stash: string | undefined }
	| { kind: 'unsaved'; directory: string; reason: string }

// One keep per issue at a time: two withdraws of one lane each reading the tree and pushing pushed one
// entry twice under one message, which `stash:pop` then refused as ambiguous (joshuafolkken/kit#6979).
// Held for a status read and one push, so the wait only bounds a holder that hung.
const KEEP_LOCK_PREFIX = 'josh-lane-keep-lock-'
const KEEP_LOCK_WAIT_MS = 60_000
const KEEP_LOCK_TIMEOUT = 'another keep of this lane held the lock for the whole wait'

function keep_lock_path(issue: string, directory: string): string {
	return repository_lock.lock_path(`${KEEP_LOCK_PREFIX}${issue}-`, directory)
}

// A tree holding only deleted tracked files is one caught mid-removal, not work (`holds_work`).
async function stash_of(
	issue: string,
	directory: string,
	occasion: string,
): Promise<string | undefined> {
	if (!(await git_stash.has_work(directory))) return undefined

	return await push_work(issue, directory, occasion)
}

async function locked_stash_of(
	issue: string,
	directory: string,
	occasion: string,
): Promise<KeptWork> {
	const kept = await repository_lock.with_lock(
		async () => ({ stash: await stash_of(issue, directory, occasion) }),
		keep_lock_path(issue, directory),
		KEEP_LOCK_WAIT_MS,
	)

	if (kept === undefined) return { kind: 'unsaved', directory, reason: KEEP_LOCK_TIMEOUT }

	return { kind: 'saved', stash: kept.stash }
}

/** Stash the tree's uncommitted work, if any, answering `unsaved` rather than throwing. */
async function keep_work(issue: string, directory: string, occasion: string): Promise<KeptWork> {
	try {
		return await locked_stash_of(issue, directory, occasion)
	} catch (error) {
		return { kind: 'unsaved', directory, reason: error_text.message_of(error) }
	}
}

// Keep whatever the issue's lane still holds uncommitted, and say on the Issue where it went — before
// `run:merge` closes a merged child's lane, or (`--stash`) classifies a stopped unit. Returns whether
// the tree is safe to remove: `false` when it could not be read or pushed, so it is left rather than
// lost. A directory with no `.git` is no work tree — the remnant of an interrupted close — and holds
// nothing git could keep.
async function preserve_lane(issue: string, occasion: string, cause: string): Promise<boolean> {
	const lane = await lane_close.resolve_lane(issue)
	const { directory } = lane.targets

	if (!existsSync(path.join(directory, '.git'))) return true

	const kept = await keep_work(issue, directory, occasion)

	if (kept.kind === 'unsaved') {
		console.error(
			`${session_cite.issue(issue)}: uncommitted work could not be stashed — lane left at ${directory}`,
		)

		return false
	}

	if (kept.stash !== undefined) await announce(issue, kept.stash, cause)

	return true
}

const lane_preserve = { announce, keep_work, preserve_lane }

export type { KeptWork }
export { lane_preserve }
