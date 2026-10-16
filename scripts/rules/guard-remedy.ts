// Every `PreToolUse` guard, classed by what its refusal asks for (joshuafolkken/kit#3920).
//
// **A refusal whose right form follows from the call alone is a wasted round trip.** The model reissues
// the call the refusal already described, at the run's whole context. Where that form is mechanical
// and stays the same tool, the hook runs it instead (`rule-rewrite.ts`) and says what it changed. Every
// other refusal asks for something the call does not carry: another tool, another command and its
// arguments, or a decision.
//
// `rewrite` means the row rewrites where it can and refuses where it cannot; `judgment` means it always
// refuses. `guard-remedy.test.ts` pins that every guard is classed and that each `rewrite` row has one.

type Remedy = 'rewrite' | 'judgment'

const GUARD_REMEDIES: Readonly<Record<string, Remedy>> = {
	// The rewrites: each fix is the same call made right.
	'piped-verification': 'rewrite', // wrapped in `(set -o pipefail; …)`
	'issue-comments': 'rewrite', // the same Issue's comments read on the same line
	'lane-background': 'rewrite', // a lane child's `ship` run in the foreground (`pretool-guard.ts`)
	// The right form is another tool, which `updatedInput` cannot switch to.
	'file-body': 'judgment', // Edit or Write
	'shell-body': 'judgment', // which part of the body the shell was meant to expand is the author's
	'raw-field-body': 'judgment', // the body moves to a file the call does not name
	'rule-body': 'judgment', // a trigger-plus-pointer line is written, not derived
	// The right act is another command, whose arguments the call does not carry.
	'direct-filing': 'judgment',
	'direct-pr-create': 'judgment',
	'josh-git-bare': 'judgment',
	'run-tail': 'judgment',
	'pre-gate-cut': 'judgment',
	'implementation-cut': 'judgment',
	'early-heartbeat': 'judgment',
	'poll-loop': 'judgment',
	'lane-park': 'judgment',
	'lane-split-park': 'judgment',
	'lane-interactive-ask': 'judgment',
	'lane-carry-conflict': 'judgment',
	'lane-switch-main': 'judgment',
	'oracle-consulted': 'judgment',
	'test-declared': 'judgment',
	batching: 'judgment',
	investigation: 'judgment',
	'duplicate-read': 'judgment',
	'run-watcher': 'judgment',
	'parent-cut': 'judgment',
	'issue-watch': 'judgment',
	// The call must not run at all, or only on a person's word.
	'third-party-write': 'judgment',
	'filing-cap': 'judgment',
	'git-force': 'judgment',
	'worktree-mutation': 'judgment',
	'index-mutation': 'judgment',
	'destructive-command': 'judgment',
	'protected-file': 'judgment',
}

// A row family shares one class: `oracle-consulted:pkg:scout` is an `oracle-consulted` row.
const FAMILY_SEPARATOR = ':'

function remedy_of(id: string): Remedy | undefined {
	return GUARD_REMEDIES[id] ?? GUARD_REMEDIES[id.split(FAMILY_SEPARATOR)[0] ?? '']
}

function is_rewrite(id: string): boolean {
	return remedy_of(id) === 'rewrite'
}

const guard_remedy = {
	GUARD_REMEDIES,
	is_rewrite,
	remedy_of,
}

export type { Remedy }
export { guard_remedy }
