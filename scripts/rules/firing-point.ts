// A behavior-change Issue names its **firing point** — the tool call first invoked at the moment
// the rule it changes would break (`prompts/collaboration-workflow/issue-template.md`). This
// classifies that name against the rule-delivery table (joshuafolkken/kit#2212).
//
// **Why the name matters.** joshuafolkken/kit#2201 placed a correct rule whose named tool call was
// one call behind the one that actually broke it: the lane child's turn ended at `AskUserQuestion`,
// which the guard never saw. A rule delivered by a hook can only fire on a tool the hook is wired to;
// a firing point naming a tool outside that set is a rule no hook can enforce, and saying so at filing
// time is the whole point of the check.

// **The hook-deliverable set — the single source is `rule-delivery.md`'s delivery table.** The
// `PreToolUse` guard is wired to `Bash|Edit|Read|Write` (`scripts/hooks/pretool-guard.ts`), and the
// lane-child interactive-ask row triggers on `AskUserQuestion`. A firing point naming one of these can
// be delivered at the moment it binds; anything else cannot.
const HOOK_DELIVERABLE_TOOLS: ReadonlyArray<string> = [
	'Bash',
	'Edit',
	'Read',
	'Write',
	'AskUserQuestion',
]

// **Known Claude Code tool calls that a hook cannot deliver a rule on.** They are real tools, so a
// firing point naming one is not a typo — it is a rule whose enforcement stays with the parent's
// self-restraint, the thing that failed in joshuafolkken/kit#2201. Kept apart from
// `HOOK_DELIVERABLE_TOOLS` so `not-delivered` (a real but undeliverable tool) reads differently from
// `unknown` (not a tool call name at all).
const KNOWN_UNDELIVERABLE_TOOLS: ReadonlyArray<string> = [
	'Grep',
	'Glob',
	'WebFetch',
	'WebSearch',
	'TodoWrite',
	'Task',
	'Agent',
	'NotebookEdit',
]

type FiringPointVerdict = 'delivered' | 'not-delivered' | 'unknown'

function includes_name(names: ReadonlyArray<string>, name: string): boolean {
	return names.includes(name.trim())
}

// Where a firing point's tool name sits against the delivery table: `delivered` when a hook can carry
// the rule (a match), `not-delivered` when the tool is real but undeliverable (a mismatch), and
// `unknown` when the name is not a tool call at all (off the table).
function classify(name: string): FiringPointVerdict {
	if (includes_name(HOOK_DELIVERABLE_TOOLS, name)) return 'delivered'

	if (includes_name(KNOWN_UNDELIVERABLE_TOOLS, name)) return 'not-delivered'

	return 'unknown'
}

const firing_point = {
	HOOK_DELIVERABLE_TOOLS,
	KNOWN_UNDELIVERABLE_TOOLS,
	classify,
}

export type { FiringPointVerdict }
export { firing_point }
