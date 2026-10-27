// Every `PreToolUse` and `Stop` guard, classed by what its refusal asks for (joshuafolkken/kit#3920),
// with the reason it cannot run itself instead.
//
// **A refusal whose right form follows from the call alone is a wasted round trip.** The model reissues
// the call the refusal already described, at the run's whole context. Where that form is mechanical
// and stays the same tool, the hook runs it instead (`rule-rewrite.ts`) and says what it changed. Every
// other refusal asks for something the call does not carry: another tool, another command and its
// arguments, or a decision.
//
// `rewrite` means the row rewrites where it can and refuses where it cannot; `judgment` means it always
// refuses. **`why` is required**: a guard is the third rung of `principles.md` → "automate-first", so
// each row says why a command or the hook running the step cannot replace it. `guard-remedy.test.ts`
// pins that every guard is classed with a non-empty `why` and that each `rewrite` row has one.

type Remedy = 'rewrite' | 'judgment'

interface GuardRemedy {
	remedy: Remedy
	// Why the hook cannot make the step itself — printed by `rule:list` as `not automated`.
	why: string
}

const REWRITTEN =
	'the hook makes the same call right itself; it refuses only a spelling it cannot rewrite'
const ANOTHER_TOOL = 'the right form is another tool, which `updatedInput` cannot switch to'
const ANOTHER_COMMAND = 'the right act is another command, whose arguments the call does not carry'
const NO_RUN = "the call must not run at all, or only on a person's word — refusing is the remedy"
// The `Stop` rows that already run their step: each blocks only on the case the hook cannot finish.
const STOP_NOTIFY = 'the hook sends the notify itself; it blocks only when the send fails'
const HOLD_RELEASE = 'the hook releases the hold itself; it blocks only when that release fails'
const FILING_OFFER = 'the filing needs a title and a body only the model can write'

function rewrite(): GuardRemedy {
	return { remedy: 'rewrite', why: REWRITTEN }
}

function judgment(why: string): GuardRemedy {
	return { remedy: 'judgment', why }
}

const GUARD_REMEDIES: Readonly<Record<string, GuardRemedy>> = {
	// The rewrites: each fix is the same call made right.
	'piped-verification': rewrite(), // wrapped in `(set -o pipefail; …)`
	'issue-comments': rewrite(), // the same Issue's comments read on the same line
	'lane-background': rewrite(), // a lane child's `ship` run in the foreground (`pretool-guard.ts`)
	'reviewer-foreground': rewrite(), // a lane child's `reviewer` given `run_in_background: false`
	'file-body': judgment(ANOTHER_TOOL), // Edit or Write
	'shell-body': judgment(
		"which part of the body the shell was meant to expand is the author's, not the hook's",
	),
	'raw-field-body': judgment('the body moves to a file the call does not name'),
	'credential-body': judgment(
		'which text is the credential, and what replaces it, is the author’s',
	),
	'rule-body': judgment('a trigger-plus-pointer line is written, not derived'),
	'direct-filing': judgment(ANOTHER_COMMAND),
	'direct-issue-comment': judgment(ANOTHER_COMMAND),
	'direct-issue-read': judgment(ANOTHER_COMMAND),
	'direct-pr-create': judgment(ANOTHER_COMMAND),
	'pr-merge': judgment(ANOTHER_COMMAND),
	'josh-git-bare': judgment(ANOTHER_COMMAND),
	'run-tail': judgment(ANOTHER_COMMAND),
	'pre-gate-cut': judgment(ANOTHER_COMMAND),
	'implementation-cut': judgment(ANOTHER_COMMAND),
	'round-one-check-related': judgment(ANOTHER_COMMAND),
	'early-heartbeat': judgment(ANOTHER_COMMAND),
	'poll-loop': judgment(ANOTHER_COMMAND),
	'lane-park': judgment(ANOTHER_COMMAND),
	'lane-split-park': judgment(ANOTHER_COMMAND),
	'lane-interactive-ask': judgment(ANOTHER_COMMAND),
	'agent-model': judgment("which model fits the unit is the author's call"),
	'investigator-foreground': judgment('which reads go beside the dispatch is the author’s call'),
	'lane-carry-conflict': judgment(ANOTHER_COMMAND),
	'lane-switch-main': judgment(ANOTHER_COMMAND),
	'lane-direct-tool': judgment(ANOTHER_COMMAND),
	'lane-spilled-read': judgment(ANOTHER_COMMAND),
	'timed-rerun': judgment(ANOTHER_COMMAND),
	'oracle-consulted': judgment(ANOTHER_COMMAND),
	'test-declared': judgment(ANOTHER_COMMAND),
	batching: judgment(ANOTHER_COMMAND),
	investigation: judgment(ANOTHER_COMMAND),
	'duplicate-read': judgment(ANOTHER_COMMAND),
	'run-watcher': judgment(ANOTHER_COMMAND),
	'parent-cut': judgment(ANOTHER_COMMAND),
	'issue-watch': judgment(ANOTHER_COMMAND),
	'third-party-write': judgment(NO_RUN),
	'git-force': judgment(NO_RUN),
	'worktree-mutation': judgment(NO_RUN),
	'index-mutation': judgment(NO_RUN),
	'destructive-command': judgment(NO_RUN),
	'repo-admin': judgment(NO_RUN),
	'protected-file': judgment(NO_RUN),
	// The `Stop` rows: the hook judges a finished reply, so it has no call to rewrite.
	'stop-notify': judgment(STOP_NOTIFY),
	'filing-offer': judgment(FILING_OFFER),
	'hold-release': judgment(HOLD_RELEASE),
}

// A row family shares one class: `oracle-consulted:pkg:scout` is an `oracle-consulted` row.
const FAMILY_SEPARATOR = ':'

function entry_of(id: string): GuardRemedy | undefined {
	return GUARD_REMEDIES[id] ?? GUARD_REMEDIES[id.split(FAMILY_SEPARATOR)[0] ?? '']
}

function remedy_of(id: string): Remedy | undefined {
	return entry_of(id)?.remedy
}

function why_of(id: string): string | undefined {
	return entry_of(id)?.why
}

function is_rewrite(id: string): boolean {
	return remedy_of(id) === 'rewrite'
}

const guard_remedy = {
	GUARD_REMEDIES,
	is_rewrite,
	remedy_of,
	why_of,
}

export type { GuardRemedy, Remedy }
export { guard_remedy }
