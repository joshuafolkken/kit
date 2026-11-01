import { git_worktree } from '#scripts/git/git-worktree'
import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'

// The tree sync a `new` entry (`run:entry <N> --adopt`) runs before its reads, so `fullrun new` and
// `halfrun new` no longer issue it as three commands of their own: pre-existing changes are set aside
// (`stash:push`), the tree is synchronized — a primary checkout by `main:sync`, a linked one by
// `main:merge` (`entry-sequence.md`) — and the changes come back (`stash:pop`). A dispatched lane child
// skips it: its ship's sync merges main.
//
// **A failed step stops the entry with the stash kept**, the report and the Telegram naming the stash,
// rather than popping onto a tree a failed merge left half-done. The message carries the issue number,
// so a stash an earlier entry kept never makes a later entry's pop answer `ambiguous`.

const STASH_PUSH = 'stash:push'
const STASH_POP = 'stash:pop'
const STASHED_VERDICT = 'stashed'
const POPPED_VERDICT = 'popped'
const CONFLICTED_VERDICT = 'conflicted'
const SUCCESS_EXIT_CODE = 0
const NEWLINE = '\n'
const should_forward_stderr = true

const SYNC_REASON = 'the working tree could not be synchronized — see the run:entry output'
const LATER_PREFIX = 'Leave the Issue for a later session'

// A stop `run:entry` reports and notifies: the note standing in for the report body, and the reason,
// recommendation and alternatives its `confirmation` Telegram carries.
interface EntryStop {
	report: string
	notice: { reason: string; recommended?: string; alternatives?: Array<string> }
}

interface SyncEntry {
	issue_number: string
	command: string
	is_adopt: boolean
}

// What a failed step left: the step, the report's note on the tree, and the Telegram's two choices.
interface StopText {
	failed: string
	kept: string
	recommended: string
	later: string
}

function stash_message({ command, issue_number }: SyncEntry): string {
	return `${command} new ${issue_cite.plain(issue_number)}: pre-existing changes`
}

function verdict_of(result: JoshResult): string {
	return result.out.split(NEWLINE)[0] ?? ''
}

async function step(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, should_forward_stderr)
}

async function sync_command(): Promise<string> {
	return (await git_worktree.is_linked()) ? 'main:merge' : 'main:sync'
}

function stopped({ failed, kept, recommended, later }: StopText): EntryStop {
	return {
		report: `(\`${failed}\` failed — see its output above; ${kept})`,
		notice: { reason: SYNC_REASON, recommended, alternatives: [`${LATER_PREFIX} — ${later}`] },
	}
}

function unstashed(failed: string, nothing: string): EntryStop {
	const recommended = 'Put the tree right, then rerun the entry'

	return stopped({ failed, kept: nothing, recommended, later: nothing })
}

function stash_kept(failed: string, message: string): EntryStop {
	return stopped({
		failed,
		kept: `the stash "${message}" is kept — pop it with \`pnpm josh stash:pop "${message}"\` once the tree is right`,
		recommended: `Put the tree right, pop the stash "${message}", then rerun the entry`,
		later: `the stash "${message}" is kept`,
	})
}

// A conflicted pop applied the changes, and git keeps the entry until the conflicts are resolved.
function pop_conflicted(message: string): EntryStop {
	return stopped({
		failed: STASH_POP,
		kept: `the changes are applied with conflicts and git kept the stash "${message}" — resolve the conflicts, then drop that entry`,
		recommended: `Resolve the conflicts, drop the kept stash "${message}", then rerun the entry`,
		later: `the conflicts and the stash "${message}" are left as they are`,
	})
}

// `ambiguous` / `no-match` popped nothing: the changes stay in whichever entry `git stash list` shows.
function pop_unmatched(message: string): EntryStop {
	return stopped({
		failed: STASH_POP,
		kept: `the stash "${message}" is kept — find it with \`git stash list\``,
		recommended: `Pop the stash "${message}" by its \`git stash list\` entry, then rerun the entry`,
		later: `the stash "${message}" is kept`,
	})
}

// The pop runs only after `stashed`; anything but `popped` stops the entry.
async function restore(message: string, is_stashed: boolean): Promise<EntryStop | undefined> {
	if (!is_stashed) return undefined

	const verdict = verdict_of(await step([STASH_POP, message]))

	if (verdict === POPPED_VERDICT) return undefined

	return verdict === CONFLICTED_VERDICT ? pop_conflicted(message) : pop_unmatched(message)
}

async function sync_tree(message: string): Promise<EntryStop | undefined> {
	const pushed = await step([STASH_PUSH, message])

	if (pushed.code !== SUCCESS_EXIT_CODE) {
		return unstashed(STASH_PUSH, 'nothing was stashed or synchronized')
	}

	const is_stashed = verdict_of(pushed) === STASHED_VERDICT
	const command = await sync_command()
	const synced = await step([command])

	if (synced.code === SUCCESS_EXIT_CODE) return await restore(message, is_stashed)

	return is_stashed ? stash_kept(command, message) : unstashed(command, 'nothing was stashed')
}

// `undefined` once the tree is synchronized, or where the sync is not this entry's — a `#N` entry's
// or a lane child's; else the stop.
async function sync(entry: SyncEntry): Promise<EntryStop | undefined> {
	if (!entry.is_adopt || lane_child_marker.is_child_of(process.cwd())) return undefined

	return await sync_tree(stash_message(entry))
}

const run_entry_sync = {
	SYNC_REASON,
	sync,
}

export { run_entry_sync }
export type { EntryStop }
