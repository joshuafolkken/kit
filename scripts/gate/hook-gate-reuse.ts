import { git_command } from '#scripts/git/git-command'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { gate_skip, type GateReuse } from './gate-skip'
import type { GateTree } from './gate-tree'

// What the two git hooks share when they decline to re-run a check `pnpm josh gate` already passed on
// this tree.
//
// The pre-push hook got this behavior first and the pre-commit type check is
// the second reader of the same record. Everything that is the same in both lives here rather than in
// each of them: the escape hatch, the pre-filter in front of the record, and the one `git status`
// reading both narrow themselves from. **The record comparison itself is not here either** — it is
// `gate_skip.reusable_green_gate`, so a hook cannot answer "is this tree
// still the recorded one" differently from the gate printing its answer beside it.
//
// **Every condition added here only ever narrows.** The gate's own three — the file map matches, the
// base commit the map is a diff against matches, and the map is non-empty — are necessary and never
// sufficient for a hook, because the gate speaks about the **working tree** while a hook guards what a
// git operation is about to carry. Where the two can differ, the hook runs the check. Any reading that
// could not be taken fails the same way: "we could not tell" must never resolve to "no need to check".

// The `josh` targets that decline a check on the strength of this record.
//
// **It is declared beside the mechanism rather than beside the reader.** `josh layers` reports which
// checks run in more than one layer, and two of the rows it prints are not the repetition they look
// like: the pre-commit type check and the pre-push unit run are skipped outright where a green gate
// already covers the tree. A reader that carried its own copy of this list would go on printing a
// retired name the day a hook is rewired, which is the drift `hook-gate-reuse.test.ts` pins by
// comparing this list against the files that actually import this module.
const GATE_REUSING_TARGETS: ReadonlyArray<string> = ['pre-commit-type-check', 'pre-push-unit']

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
//
// **The observation ledger is dropped from the reading, and it is the one line that may be**.
// Lines are appended throughout a run — a review's record lands after its
// gate — and every condition below reads a non-empty status as "this operation carries a tree no
// check has read". Left in, one ledger line would send every commit and every push in the primary
// checkout back to the full gate, which is the reuse this module exists to grant. **Dropping it is
// sound because the ledger is no code any check runs**: `pnpm josh git` stages it with the run's
// commit only after its grammar has been parsed, and the rest of its content
// is checked by the CI of the pull request that carries it.
async function read_status_lines(): Promise<ReadonlyArray<string> | undefined> {
	try {
		const status = await git_command.status()

		return status
			.split('\n')
			.filter((line) => line !== '')
			.filter((line) => !observation_ledger.is_ledger_line(line))
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
	// The reason a refusal on that narrowing reports, in the hook's own words.
	carry_miss: string
	extra_arguments: ReadonlyArray<string>
	force_env: string
	// The record to read, so a test can plant one without overwriting the record a live run relies on.
	// `| undefined` is explicit because `exactOptionalPropertyTypes` is on: each hook passes its own
	// optional parameter straight through, and omitting it would refuse the value it always has.
	source?: string | undefined
}

// The stamp rather than a boolean, for the same reason `gate_skip.gate_reuse` hands one back: the
// caller prints `taken_at`, and a record that does not describe this tree has no timestamp worth
// printing. A refusal carries its reason instead.
//
// **Any argument at all refuses the reuse**, not only the force flag. A caller who narrowed the run
// asked for that run rather than for a recorded result about a whole tree, and a hook's own line passes
// none, so this costs it nothing.
function hook_reuse(input: HookReuse): GateReuse {
	if (input.extra_arguments.length > 0) return { miss: 'arguments were passed to the hook' }
	if (is_force_requested(input.force_env)) return { miss: `${input.force_env} is set` }
	if (!input.is_tree_carried) return { miss: input.carry_miss }

	return gate_skip.gate_reuse(input.tree.files, input.tree.base, input.source)
}

const hook_gate_reuse = {
	GATE_REUSING_TARGETS,
	hook_reuse,
	is_force_requested,
	is_index_matching_worktree,
	is_worktree_clean,
	read_status_lines,
}

export type { HookReuse }
export { hook_gate_reuse }
