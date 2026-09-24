import type { CommandEntry } from './josh-command-types'

// The `backlog:*` command registry, split out of `josh-commands-ai.ts` so that file stays under its
// 300-code-line limit, exactly as `LANE_COMMANDS` and `SPLIT_COMMANDS` were for the same reason
// (joshuafolkken/kit#2162, joshuafolkken/kit#2218). It is spread into `AI_COMMANDS` so the commands
// stay grouped with the other AI tools under the 'AI tools' category.

/* eslint-disable @typescript-eslint/naming-convention */
const BACKLOG_COMMANDS: Record<string, CommandEntry> = {
	'backlog:next': {
		script: 'scripts/backlog/backlog-next.ts',
		description:
			'Order the whole opted-in backlog: auto-ok issues and the descendants of auto-ok epics, transitively through nested epics',
		category: 'AI tools',
		reference: ['[--exclude <n>[,<n>...]] [--repo <owner/repo>]', 'automation', ['network']],
	},
	'backlog:offer': {
		script: 'scripts/backlog/backlog-offer-cli.ts',
		description:
			'Collapse a backlogrun loop-head event into one call: read backlog:next, ask backlog:budget, return the verdict and any issues to start',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['network']],
	},
	'backlog:drive': {
		script: 'scripts/backlog/backlog-drive-cli.ts',
		description:
			'Drive the backlogrun parent loop (offer, launch, await, merge) until a judgement branch, and print that branch as one line',
		category: 'AI tools',
		reference: [
			'[--max <n>] [--idle <minutes>] [--stash <message>] [--owner <pid>]',
			'automation',
			['network'],
		],
	},
	'backlog:plan': {
		script: 'scripts/backlog/backlog-plan-cli.ts',
		description:
			'Print the whole backlog as a plan: ready now, waiting on what, waiting on a person, out of scope',
		category: 'AI tools',
		reference: ['[issue...] [--only]', 'automation', ['network']],
	},
	'backlog:stalled': {
		script: 'scripts/backlog/backlog-stalled-cli.ts',
		description:
			'Report whether ready backlog work is sitting undispatched with a free lane and no recent dispatch',
		category: 'AI tools',
		reference: ['', 'automation', ['network']],
	},
	'backlog:budget': {
		script: 'scripts/backlog/backlog-budget-cli.ts',
		description: 'Say whether a backlogrun may start more work, keep watching, or finish',
		category: 'AI tools',
		reference: ['[options]', 'automation', ['none']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { BACKLOG_COMMANDS }
