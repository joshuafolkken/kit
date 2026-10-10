import { git_command } from './git-command'
import { git_spawn } from './git-spawn'

// **The change base as a commit, or nothing — never a ref name**.
//
// `git_command.change_base` degrades to the default-branch *name* when `merge-base` cannot answer,
// and a name moves. Any reader that stores one reading and compares it against a later one — the
// gate's green record, and the round-1 review snapshot — would then compare that identical string
// while the tree under it is replaced, so the guard fails **open**: the one direction a guard built
// to catch a moved base must not fail in. `undefined` makes the comparison fail closed instead, and
// every caller answers it by widening its round or re-running its checks.
//
// It sits beside `git-command.ts` rather than inside it because that file is at its line limit, and
// it is one module rather than two copies of this `try` — the gate already had one — because that
// duplication is the clone `CLAUDE.md` prohibits. Keeping the `try` on this side also means a caller
// whose suite mocks `git_command` degrades to `undefined` exactly as it did before.
async function resolved(): Promise<string | undefined> {
	try {
		return await git_command.change_base_commit()
	} catch {
		return undefined
	}
}

const MERGE_BASE_COMMAND = 'merge-base'
const MERGE_HEAD = 'MERGE_HEAD'
const LINE_BREAK = '\n'

// Where the side a merge in progress brings in left the default branch — `undefined` where no merge
// is in progress, which is every ordinary run.
async function incoming_base(): Promise<string | undefined> {
	try {
		const reference = await git_command.default_branch_reference()

		return await git_spawn.read([MERGE_BASE_COMMAND, reference, MERGE_HEAD])
	} catch {
		return undefined
	}
}

// `--independent` drops every commit another one listed reaches, so of two commits on the default
// branch's history it keeps the later.
async function later_of(base: string, incoming: string): Promise<string> {
	const kept = await git_spawn.read([MERGE_BASE_COMMAND, '--independent', base, incoming])
	const [later = base] = kept.split(LINE_BREAK)

	return later
}

// **The base of the tree, not of `HEAD`, while a merge is in progress.** A merge of the default
// branch that stopped on a conflict has already put the default branch's files in the work tree, but
// `HEAD` is still the commit before it — so `resolved` answers the old merge-base and everything the
// default branch brought in reads as this branch's own change. The commit the merge is about to make
// has both parents, and its merge-base is the later of theirs; that is the commit a reader measuring
// the *tree* has to hold it to, and the one `resolved` answers by itself once the merge is committed.
async function resolved_through_merge(): Promise<string | undefined> {
	const [base, incoming] = await Promise.all([resolved(), incoming_base()])

	if (base === undefined || incoming === undefined) return base

	return await later_of(base, incoming)
}

const change_base = { resolved, resolved_through_merge }

export { change_base }
