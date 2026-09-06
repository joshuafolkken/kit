import { gate_skip } from './gate-skip'
import type { GateTree } from './gate-tree'
import { git_command } from './git/git-command'
import type { FileMapStamp } from './josh/file-map-stamp'

// What the two git hooks share when they decline to re-run a check `pnpm josh gate` already passed on
// this tree (joshuafolkken/kit#1381).
//
// The pre-push hook got this behavior first (joshuafolkken/kit#1334) and the pre-commit type check is
// the second reader of the same record. Everything that is the same in both lives here rather than in
// each of them: the escape hatch, the pre-filter in front of the record, and the one `git status`
// reading both narrow themselves from. **The record comparison itself is not here either** — it is
// `gate_skip.reusable_green_gate`, joshuafolkken/kit#1328's, so a hook cannot answer "is this tree
// still the recorded one" differently from the gate printing its answer beside it.
//
// **Every condition added here only ever narrows.** The gate's own three — the file map matches, the
// base commit the map is a diff against matches, and the map is non-empty — are necessary and never
// sufficient for a hook, because the gate speaks about the **working tree** while a hook guards what a
// git operation is about to carry. Where the two can differ, the hook runs the check. Any reading that
// could not be taken fails the same way: "we could not tell" must never resolve to "no need to check".

// `git status --porcelain` prints `XY PATH` per difference — `X` the index against HEAD, `Y` the
// working tree against the index — so column 1 is the one that says whether the staged content is
// what is on disk. An untracked file is `??`, which fails this test too.
const WORKTREE_COLUMN = 1
const UNMODIFIED = ' '

// The escape hatch, for the times a person knows something outside the tree moved — a `pnpm install`,
// a toolchain change, a cache thrown away. An environment variable rather than the gate's `--force`
// flag because a hook's command line belongs to `lefthook/base.yml`: nobody types that invocation, so
// a flag alone would be unreachable at the moment it is wanted. Each hook names its own variable and
// passes it in, so the two escape hatches cannot be confused for one another.
//
// Any value at all, empty string aside: this is read from a shell, where `JOSH_…_FORCE=1` and
// `JOSH_…_FORCE=true` are the two spellings a person reaches for and neither should be the one that
// silently does nothing.
function is_force_requested(force_environment: string): boolean {
	return (process.env[force_environment] ?? '') !== ''
}

// `undefined` rather than an empty list when the reading failed, so a caller cannot mistake "git said
// nothing" for "git could not be asked". Every predicate below treats the two differently.
async function read_status_lines(): Promise<ReadonlyArray<string> | undefined> {
	try {
		const status = await git_command.status()

		return status.split('\n').filter((line) => line !== '')
	} catch {
		return undefined
	}
}

// The pre-push condition: nothing differs from HEAD at all, untracked files included, so the commit
// being pushed is byte-for-byte the tree the record was taken from.
function is_worktree_clean(lines: ReadonlyArray<string> | undefined): boolean {
	return lines?.length === 0
}

// The pre-commit condition: the commit carries the **index**, so what must match the recorded working
// tree is the index rather than HEAD. Staged-only entries (`M `, `A `, `R `) pass; an unstaged edit
// (` M`), a partially staged file (`MM`) and an untracked file (`??`) each mean the commit is a tree no
// check has read, and send the hook back to the full check.
function is_index_matching_worktree(lines: ReadonlyArray<string> | undefined): boolean {
	return lines?.every((line) => line[WORKTREE_COLUMN] === UNMODIFIED) === true
}

interface HookReuse {
	// The gate's own two readings — the changed-file map and the commit it is a diff against — taken
	// from `gate-tree.ts` rather than read a second way here.
	tree: GateTree
	// The hook-specific narrowing: whether what this git operation carries is the tree the record
	// describes. `is_worktree_clean` for a push, `is_index_matching_worktree` for a commit.
	is_tree_carried: boolean
	extra_arguments: ReadonlyArray<string>
	force_env: string
	// The record to read, so a test can plant one without overwriting the record a live run relies on.
	// `| undefined` is explicit because `exactOptionalPropertyTypes` is on: each hook passes its own
	// optional parameter straight through, and omitting it would refuse the value it always has.
	source?: string | undefined
}

// The stamp rather than a boolean, for the same reason `gate_skip.reusable_green_gate` hands one back:
// the caller prints `taken_at`, and a record that does not describe this tree has no timestamp worth
// printing.
//
// **Any argument at all refuses the reuse**, not only the force flag. A caller who narrowed the run
// asked for that run rather than for a recorded result about a whole tree, and a hook's own line passes
// none, so this costs it nothing.
function reusable_green_hook(input: HookReuse): FileMapStamp | undefined {
	if (input.extra_arguments.length > 0 || is_force_requested(input.force_env)) return undefined
	if (!input.is_tree_carried) return undefined

	return gate_skip.reusable_green_gate(input.tree.files, input.tree.base, input.source)
}

const hook_gate_reuse = {
	is_force_requested,
	is_index_matching_worktree,
	is_worktree_clean,
	read_status_lines,
	reusable_green_hook,
}

export type { HookReuse }
export { hook_gate_reuse }
