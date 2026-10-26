import type { CommandEntry } from './josh-command-types'
import { ISSUE_WRITE_COMMANDS } from './josh-commands-issue-write'

const REPO = '--repo <owner/repo>'
const CONCURRENT = 'several numbers, read concurrently'
const REPO_FLAG = {
	names: [REPO],
	description: 'read a child in another repository; applies to every number.',
}
const BODY_FILE = '--body-file <path>'
const JSON_FLAG = { names: ['--json'], description: 'print the verdict and reason as JSON.' }

// The issue-reading and issue-citation commands, split out of `josh-commands-ai.ts` when the mandated
// `issue:cite` section pushed that file past its 300-line ceiling — the same
// group-per-file shape `LANE_COMMANDS` and `SPLIT_COMMANDS` already take. `COMMAND_MAP` spreads this
// in, so nothing downstream sees where an entry lives.

// The synopsis `issue:state` and `issue:cite` share: a list of numbers with an optional cross-repo
// flag. One constant, so the two cannot drift and the literal is not duplicated.
const ISSUES_WITH_REPO = '<issue...> [--repo <owner/repo>]'

/* eslint-disable @typescript-eslint/naming-convention */
const ISSUE_COMMANDS: Record<string, CommandEntry> = {
	'issue:ack': {
		script: 'scripts/issue/issue-ack-cli.ts',
		description:
			"Record that the run read a person's update to its issue, printing the update it acknowledges",
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
		usage: { examples: [{ arguments: '3773' }] },
	},
	'issue:priority': {
		script: 'scripts/issue/issue-priority-cli.ts',
		description: 'Apply priority:high to an issue whose body reached the high floor after filing',
		category: 'AI tools',
		reference: ['<issue>', 'automation', ['network']],
		usage: { examples: [{ arguments: '4960' }] },
	},
	'issue:read': {
		script: 'scripts/issue/issue-read-main.ts',
		description: "Print each issue's title, body and every comment on it, in one call",
		category: 'AI tools',
		reference: ['<issue...>', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '1715' }, { arguments: '1715 1567 1605', note: CONCURRENT }],
		},
	},
	'issue:state': {
		script: 'scripts/issue/issue-state-main.ts',
		description:
			"Print each issue's state and labels, in the spelling the documents compare against",
		category: 'AI tools',
		reference: [ISSUES_WITH_REPO, 'automation', ['network']],
		usage: {
			examples: [
				{ arguments: '42', note: 'single-number shape' },
				{ arguments: '42 43 44', note: 'each block headed by `issue:`' },
				{ arguments: '42 43 --repo joshuafolkken/app-kit', note: 'a child in another repo' },
			],
			flags: [REPO_FLAG],
		},
	},
	'issue:scout': {
		script: 'scripts/issue/issue-scout-main.ts',
		description:
			'Before filing: say whether an issue like this exists and which epic it belongs to',
		category: 'AI tools',
		reference: ['<title> [--body <summary> | --body-file <path>]', 'automation', ['network']],
		usage: {
			examples: [
				{ arguments: '"Stop the gate re-running after every edit"' },
				{ arguments: '"<title>" --body "parent: #1246"' },
				{ arguments: '"<title>" --body-file draft.md' },
			],
			flags: [
				{
					names: ['--body "<text>"'],
					description:
						'supply references (`#N`) in a `parent: #N` line or an acceptance-criteria section so the epic half has a number to work from; without one there (a background mention does not count) it prints `Epic: not asked`.',
				},
				{
					names: [BODY_FILE],
					description:
						'pass the whole draft, including its purpose, requirements and acceptance criteria. A file that cannot be read ends the command rather than being treated as "no candidates".',
				},
			],
		},
	},
	'defect:origin': {
		script: 'scripts/issue/defect-origin-main.ts',
		description:
			'List the merged pull requests that last changed what a defect issue names, as candidates for its origin line',
		category: 'AI tools',
		reference: ['<N>', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '4241', note: 'newest first, merged before the issue was filed' }],
		},
	},
	'defect:report': {
		script: 'scripts/issue/defect-report-main.ts',
		description:
			'Count defects by the origin pull request their issue declares, by change kind and by area',
		category: 'AI tools',
		reference: ['', 'automation', ['network']],
		usage: { examples: [{ arguments: '', note: 'every issue labelled bug, open or closed' }] },
	},
	'effect:audit': {
		script: 'scripts/issue/effect-audit-cli.ts',
		description:
			'List closed run-time-shortening issues with their expected effect, follow-up measurement and result',
		category: 'AI tools',
		reference: ['[--days <N>] [--draft <issue>]', 'automation', ['network', 'files']],
		usage: {
			examples: [
				{ arguments: '', note: 'issues closed in the last 30 days, one line each' },
				{ arguments: '--days 7', note: 'a shorter window' },
				{
					arguments: '--draft 4896',
					note: 'write the retirement candidate of a shortfall and print its issue:file line',
				},
			],
			flags: [
				{ names: ['--days <N>'], description: 'the window, in days back from now (default 30)' },
				{
					names: ['--draft <issue>'],
					description:
						'an issue whose measurement carries measured:unmet: write its retirement-candidate body to a temporary file',
				},
			],
		},
	},
	'issue:fold': {
		script: 'scripts/issue/issue-fold-main.ts',
		description:
			'Before a second filing: say whether findings from this session fold into one issue',
		category: 'AI tools',
		reference: ['<title>... [--not-separable] [--json]', 'automation', ['none']],
		usage: {
			examples: [
				{
					arguments: '"First finding" "Second finding"',
					note: 'fold | separate | no-fold-needed | undetermined',
				},
				{ arguments: '"a" "b" --not-separable', note: 'the pair is really one deliverable → fold' },
				{ arguments: '"a" "b" --json', note: 'the verdict and reason, machine-readable' },
			],
			flags: [
				{
					names: ['--not-separable'],
					description:
						'declare the judgement half: the findings are one deliverable, so they fold whatever their size.',
				},
				JSON_FLAG,
			],
		},
	},
	'issue:fold-existing': {
		script: 'scripts/issue/issue-fold-existing-cli.ts',
		description: 'Assess whether a complete draft can join an unstarted issue',
		category: 'AI tools',
		reference: ['<assessment.json> [--json]', 'automation', ['none']],
		usage: { examples: [{ arguments: 'assessment.json --json' }] },
	},
	'issue:cite': {
		script: 'scripts/issue/issue-cite-main.ts',
		description: 'Print the paste-ready number-link citation line for each issue, in one call',
		category: 'AI tools',
		reference: [ISSUES_WITH_REPO, 'automation', ['network']],
		usage: {
			examples: [
				{ arguments: '2220' },
				{ arguments: '2220 1758 1252', note: CONCURRENT },
				{
					arguments: '45 --repo joshuafolkken/app-kit',
					note: 'bare numbers in another repository',
				},
				{ arguments: 'joshuafolkken/app-kit#45 2220', note: 'per-token owner/repo#N notation' },
			],
			flags: [
				{
					names: [REPO],
					description:
						'the repository for every bare number; a token written `owner/repo#N` overrides it for itself.',
				},
			],
		},
	},
	...ISSUE_WRITE_COMMANDS,
	'plan:consumers': {
		script: 'scripts/issue/plan-consumers-main.ts',
		description:
			"List every existing reference to each identifier a plan adds or changes, by kind, and draft the plan's existing-consumers section",
		category: 'AI tools',
		reference: ['<identifier...>', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: 'lane:pause' },
				{ arguments: 'lane:pause run:paused', note: 'one block per identifier, one draft' },
			],
		},
	},
	'issue:release': {
		script: 'scripts/issue/issue-release-main.ts',
		description:
			"Link an Issue to the repository's open release Issue as its blocker (or, with --wait, as waiting on it), filing one when none is open",
		category: 'AI tools',
		reference: ['<issue> [--wait]', 'automation', ['network']],
		usage: {
			examples: [
				{ arguments: '3360' },
				{ arguments: '3716 --wait', note: 'blocked by the release issue instead' },
			],
			flags: [
				{
					names: ['--wait'],
					description:
						'the issue is blocked by the release issue instead, so `backlog:next` offers it again once the release ships (`.claude/skills/workflow-commands/prerequisite.md`).',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { ISSUE_COMMANDS }
