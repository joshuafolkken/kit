import { git_command } from './git-command'

// **The change base as a commit, or nothing — never a ref name** (joshuafolkken/kit#1537).
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

const change_base = { resolved }

export { change_base }
