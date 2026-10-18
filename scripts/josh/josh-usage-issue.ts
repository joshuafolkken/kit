import type { CommandUsage } from './josh-command-types'

// The usage of the issue commands `docs/josh-commands-backlog.md` documents under "Issues", keyed by
// command name. The page's usage blocks are generated from this table and `josh help <command>`
// prints it, so an example or a flag is written once, here (#3938). The epic and backlog commands are
// `josh-usage-backlog.ts`, the review and delegation commands `josh-usage-review.ts`.
const REPO = '--repo <owner/repo>'
const BODY_FILE = '--body-file <path>'
const DIR = '--dir <path>'
const CONCURRENT = 'several numbers, read concurrently'
const REPO_FLAG = {
	names: [REPO],
	description: 'read a child in another repository; applies to every number.',
}
const JSON_FLAG = { names: ['--json'], description: 'print the verdict and reason as JSON.' }

/* eslint-disable @typescript-eslint/naming-convention */
const ISSUE_USAGE: Readonly<Record<string, CommandUsage>> = {
	'issue:read': {
		examples: [{ arguments: '1715' }, { arguments: '1715 1567 1605', note: CONCURRENT }],
	},
	'issue:ack': { examples: [{ arguments: '3773' }] },
	'issue:state': {
		examples: [
			{ arguments: '42', note: 'single-number shape' },
			{ arguments: '42 43 44', note: 'each block headed by `issue:`' },
			{ arguments: '42 43 --repo joshuafolkken/app-kit', note: 'a child in another repo' },
		],
		flags: [REPO_FLAG],
	},
	'issue:release': {
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
	'issue:scout': {
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
	'issue:file': {
		examples: [
			{ arguments: '"<title>" --body-file body.md' },
			{ arguments: '"<title>" --body-file body.md --route tier-a --repo joshuafolkken/kit' },
			{ arguments: '"<title>" --body-file body.md --distinct 2801,2795' },
		],
		flags: [
			{ names: [BODY_FILE], description: 'the body. Required.' },
			{
				names: ['--route <tier-a|split|interrupt|review-cap>'],
				description:
					'the `route:` label naming the filing route. Omit it for a filing with no route.',
			},
			{
				names: ['--label <name>'],
				description: 'an extra label (for example `epic`). Repeatable.',
			},
			{
				names: [REPO],
				description: 'the target repository. Defaults to this repository.',
			},
			{
				names: ['--distinct <N,…>'],
				description: 'duplicate candidates you read and judged distinct.',
			},
			{
				names: ['--over-cap'],
				description: 'the run is blocked by this filing; the cap lets it through.',
			},
			{
				names: ['--no-auto-ok'],
				description: "needs a person's judgement (Tier B / C); no `auto-ok`.",
			},
			{
				names: ['--release'],
				description:
					"a consumer can use the change only once it is published. The filed issue becomes a blocker of the target's release issue (step 10).",
			},
		],
	},
	'issue:fold-existing': { examples: [{ arguments: 'assessment.json --json' }] },
	'issue:fold': {
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
	'issue:cite': {
		examples: [
			{ arguments: '2220' },
			{ arguments: '2220 1758 1252', note: CONCURRENT },
			{ arguments: '45 --repo joshuafolkken/app-kit', note: 'bare numbers in another repository' },
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
	'issue:comment': {
		examples: [
			{
				arguments: '2304 --body-file .josh/tmp/park.md',
				note: 'the body from a file — no shell evaluates it',
			},
			{
				arguments: '2304 --body "a short note"',
				note: 'inline, for a body with no backticks or $',
			},
		],
		flags: [
			{
				names: ['--body <text>'],
				description: 'the comment body, inline. Trimmed, with `\\n` expanded to a newline.',
			},
			{
				names: [BODY_FILE],
				description:
					'read the body from a file, or from stdin with `-`. The safe form the rule steers every caller toward.',
			},
		],
	},
	'issue:plan': {
		examples: [
			{
				arguments: '4134 --body-file plan.md --title "Add issue:plan" --planned',
				note: "kickoff's three writes",
			},
		],
		flags: [
			{
				names: [BODY_FILE],
				description: 'the plan, from a file or stdin (`-`): a blank body takes it, else a comment.',
			},
			{ names: ['--title <title>'], description: 'replace the issue title first.' },
			{
				names: ['--planned'],
				description:
					'apply `run:planned` once the plan is posted, so the next entry skips planning.',
			},
			{
				names: ['--repo <owner/name>'],
				description: "write to that repository's issue.",
			},
		],
	},
	'issue:already-done': {
		examples: [
			{
				arguments: '4130 --evidence-file .josh/tmp/already-done.md',
				note: 'comment, label, release — in that order',
			},
		],
		flags: [
			{
				names: ['--evidence-file <path>'],
				description:
					'the evidence comment: the merging PR or commit and, per acceptance criterion, its `file:line`. An empty file is refused before anything is written.',
			},
		],
	},
	'pkg:scout': {
		examples: [{ arguments: '"date formatting" --size 5' }],
		flags: [
			{ names: ['--size <n>'], description: 'how many candidates to fetch and rank (default 10).' },
		],
	},
	'issue:lint': { examples: [{ arguments: '.josh/tmp/issue-body.md' }] },
	'defect:rate': {
		examples: [{ arguments: '', note: 'the last 14 days' }, { arguments: '--days 30' }],
		flags: [
			{
				names: ['--days <n>'],
				description:
					'the window in whole days (default 14, at most 3650). Anything else prints the usage and exits 1.',
			},
		],
	},
	'issue:backlinks': { examples: [{ arguments: '2123' }] },
	'report:lint': { examples: [{ arguments: '< summary.md' }] },
	'stash:push': {
		examples: [{ arguments: '"backlogrun: josh latest before lanes"' }],
		flags: [
			{
				names: [DIR],
				description: 'stashes that work tree (`git -C <path>`); without it the current checkout.',
			},
		],
	},
	'stash:pop': {
		examples: [
			{ arguments: '"backlogrun: parked #2028"' },
			{
				arguments: '"backlogrun: josh latest before lanes" --dir "$dir"',
				note: "into a lane's work tree",
			},
		],
		flags: [
			{
				names: [DIR],
				description:
					'applies the pop in that work tree (`git -C <path>`); without it the pop lands in the current checkout. The stack is shared, so it reads the same either way.',
			},
		],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { ISSUE_USAGE }
