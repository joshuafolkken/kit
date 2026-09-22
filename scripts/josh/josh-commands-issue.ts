import type { CommandEntry } from './josh-command-types'

// The issue-reading and issue-citation commands, split out of `josh-commands-ai.ts` when the mandated
// `issue:cite` section pushed that file past its 300-line ceiling (joshuafolkken/kit#2220) — the same
// group-per-file shape `LANE_COMMANDS` and `SPLIT_COMMANDS` already take. `COMMAND_MAP` spreads this
// in, so nothing downstream sees where an entry lives.

// The synopsis `issue:state` and `issue:cite` share: a list of numbers with an optional cross-repo
// flag. One constant, so the two cannot drift and the literal is not duplicated.
const ISSUES_WITH_REPO = '<issue...> [--repo <owner/repo>]'

/* eslint-disable @typescript-eslint/naming-convention */
const ISSUE_COMMANDS: Record<string, CommandEntry> = {
	'issue:read': {
		script: 'scripts/issue/issue-read-cli.ts',
		description: "Print each issue's title, body and every comment on it, in one call",
		category: 'AI tools',
		reference: ['<issue...>', 'automation', ['network']],
	},
	'issue:state': {
		script: 'scripts/issue/issue-state-cli.ts',
		description:
			"Print each issue's state and labels, in the spelling the documents compare against",
		category: 'AI tools',
		reference: [ISSUES_WITH_REPO, 'automation', ['network']],
	},
	'issue:scout': {
		script: 'scripts/issue/issue-scout-cli.ts',
		description:
			'Before filing: say whether an issue like this exists and which epic it belongs to',
		category: 'AI tools',
		reference: ['<title> [--body <summary>]', 'automation', ['network']],
	},
	'issue:fold': {
		script: 'scripts/issue/issue-fold-cli.ts',
		description:
			'Before a second filing: say whether findings from this session fold into one issue',
		category: 'AI tools',
		reference: ['<title>... [--not-separable] [--json]', 'automation', ['none']],
	},
	'issue:cite': {
		script: 'scripts/issue/issue-cite-cli.ts',
		description: 'Print the paste-ready number-link citation line for each issue, in one call',
		category: 'AI tools',
		reference: [ISSUES_WITH_REPO, 'automation', ['network']],
	},
	'issue:comment': {
		script: 'scripts/issue/issue-comment-cli.ts',
		description: 'Post one comment to an issue from a file, so no shell expands the body',
		category: 'AI tools',
		reference: ['<issue> --body <text> | --body-file <path>', 'automation', ['network']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { ISSUE_COMMANDS }
