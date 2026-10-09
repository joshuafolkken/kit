import { rule_registry_rows, type RegisteredRule } from './rule-registry-rows'

// The human-readable side of every trigger-delivered rule, keyed by the `id` its guard row carries.
// `prompts/collaboration-workflow/rule-delivery.md` used to hold this list
// as a hand copy of `delivered-rules.ts`; `pnpm josh rule:list` now renders it from here, and
// `rule-list.test.ts` pins that every row of `MEASURED_RULES` has an entry and no entry is orphaned.
//
// A hookless agent reads the rendered list as a self-applied checklist (`principles.md`). An entry
// with no frequency in `fires` is delivered once per run; "every occurrence" fires each time, "until"
// refuses until a prerequisite is on the transcript, and "again" re-fires after an interval.

const { GUARD_ROWS, RULE_GUARD } = rule_registry_rows
const STOP_GUARD = 'pnpm josh stop:guard'

// The oracle rows share one entry: each `oracle-consulted:<name>` id is generated per oracle.
const ORACLE_PREFIX = 'oracle-consulted'

const MEASURED_ROWS: ReadonlyArray<RegisteredRule> = [
	{
		id: ORACLE_PREFIX,
		title: 'An act its oracle was not asked about',
		topic: '`decision-oracle.ts`',
		entry: RULE_GUARD,
		fires:
			'a `Bash` governed by an oracle that declared a firing point (`pkg:scout` governs `pnpm add`), issued without that `pnpm josh <command>`. Refused until it ran',
		quiet: 'no governed act, or the oracle already ran',
	},
	{
		id: 'batching',
		title: 'Turn batching',
		topic: '`turn-batching.md`',
		entry: 'pnpm josh batch:guard',
		fires:
			'the `Bash` / `Edit` / `Read` after three single-call turns in a row; fires **again** every three more such turns',
		quiet: 'calls per round trip above the floor',
	},
	{
		id: 'investigation',
		title: 'Investigation delegation threshold',
		topic: '`delegation.md`',
		entry: 'pnpm josh investigation:guard',
		fires:
			'the `Read` / `Bash` that makes the third read of a file the run will not edit; fires **again** once reads pile up to the threshold again',
		quiet: 'reads under the threshold — nothing to delegate yet',
	},
]

// The `Stop` hook's rows; `stop:guard` judges every stop, so each blocks the stop while it holds.
const STOP_ROWS: ReadonlyArray<RegisteredRule> = [
	{
		id: 'stop-notify',
		title: 'Stop notification',
		topic: '`CLAUDE.md` → "Mid-workflow stop notification"',
		entry: STOP_GUARD,
		fires: 'a stop with the work tree held and no `confirmation` notify that turn. Blocks the stop',
		quiet: 'no hold, a `confirmation` notify on the tail, or a pre-gate cut taken',
	},
	{
		id: 'hold-release',
		title: 'Hold release',
		topic: '`.claude/skills/workflow-commands/working-tree-hold.md`',
		entry: STOP_GUARD,
		fires: 'a stop on a clean tree with the `run:hold` record still in place. Blocks the stop',
		quiet:
			'a dirty tree (a `halfrun` stop before the commit, a `needs-human-review` stop) or already released',
	},
	{
		id: 'issue-citation',
		title: 'Issue citation format',
		topic: '`prompts/collaboration-workflow/issue-citation.md`',
		entry: STOP_GUARD,
		fires:
			'a bare `#N` in the prose of the last reply. Blocks the stop until the reply is reissued with the citation fixed',
		quiet: 'link form, inside code or a quote, `#N` right after `PR`, or a GitHub-facing artifact',
	},
	{
		id: 'filing-offer',
		title: 'Offer to file',
		topic: '`.claude/skills/workflow-commands/observation-filing.md`',
		entry: STOP_GUARD,
		fires:
			'an unattended run (a kit-launched headless session, a lane child, a `backlogrun` parent) whose last reply offers to file without filing. Blocks the stop',
		quiet:
			'an interactive session, already filed, inside a fence or quote, a named third-party `owner/repo`, or an unknown owner',
	},
]

const REGISTERED_RULES: ReadonlyArray<RegisteredRule> = [
	...GUARD_ROWS,
	...MEASURED_ROWS,
	...STOP_ROWS,
]

// A guard row's id, with a generated oracle id read as the one oracle entry.
function registry_id(row_id: string): string {
	return row_id.startsWith(`${ORACLE_PREFIX}:`) ? ORACLE_PREFIX : row_id
}

function entry_for(row_id: string): RegisteredRule | undefined {
	const id = registry_id(row_id)

	return REGISTERED_RULES.find((rule) => rule.id === id)
}

const rule_registry = { REGISTERED_RULES, STOP_ROWS, entry_for, registry_id }

export { rule_registry }

export { type RegisteredRule } from './rule-registry-rows'
