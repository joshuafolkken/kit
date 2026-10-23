import type { DeliveredRule } from './delivered-rules'

// The `Stop` hook's rows; `stop:guard` judges every stop. A row with a fixed answer runs it itself and
// blocks only when that fails; a row that needs judgement blocks the stop while it holds. They have no
// guard row, so the listing reads their description from here.

type StopRule = Pick<DeliveredRule, 'about' | 'id'>

const STOP_GUARD = 'pnpm josh stop:guard'

const ROWS: ReadonlyArray<StopRule> = [
	{
		id: 'stop-notify',
		about: {
			title: 'Stop notification',
			topic: '`CLAUDE.md` → "Mid-workflow stop notification"',
			entry: STOP_GUARD,
			fires:
				'a stop with the work tree held and no `confirmation` notify that turn. Sends the notify itself; blocks only when the send fails',
			quiet: 'no hold, a `confirmation` notify on the tail, or a pre-gate cut taken',
		},
	},
	{
		id: 'hold-release',
		about: {
			title: 'Hold release',
			topic: '`.claude/skills/workflow-commands/working-tree-hold.md`',
			entry: STOP_GUARD,
			fires:
				'a stop on a clean tree with the `run:hold` record still in place. Releases the hold itself; blocks only when that fails',
			quiet:
				'a dirty tree (a `halfrun` stop before the commit, a `needs-human-review` stop) or already released',
		},
	},
	{
		id: 'issue-citation',
		about: {
			title: 'Issue citation format',
			topic: '`prompts/collaboration-workflow/issue-citation.md`',
			entry: STOP_GUARD,
			fires:
				'a bare `#N` in the prose of the last reply. Prints the citation lines itself; blocks only when a number cannot be cited',
			quiet:
				'link form, inside code or a quote, `#N` right after `PR`, or a GitHub-facing artifact',
		},
	},
	{
		id: 'filing-offer',
		about: {
			title: 'Offer to file',
			topic: '`.claude/skills/workflow-commands/observation-filing.md`',
			entry: STOP_GUARD,
			fires:
				'an unattended run (a kit-launched headless session, a lane child, a `backlogrun` parent) whose last reply offers to file without filing. Blocks the stop',
			quiet:
				'an interactive session, already filed, inside a fence or quote, a named third-party `owner/repo`, or an unknown owner',
		},
	},
]

const stop_rule_rows = { ROWS }

export type { StopRule }
export { stop_rule_rows }
