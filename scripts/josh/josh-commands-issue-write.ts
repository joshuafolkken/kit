import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const REPO = '--repo <owner/repo>'
const BODY_FILE = '--body-file <path>'
const EVIDENCE_FILE = '--evidence-file <path>'
const EVIDENCE_REFERENCE = `<issue> ${EVIDENCE_FILE}`

// The commands that write to an issue — comment, plan, already-done, measured and file — split out of
// `josh-commands-issue.ts` when each command's usage moved onto its entry (#4185). `ISSUE_COMMANDS`
// spreads this in at the same place, so the map keeps its order.

/* eslint-disable @typescript-eslint/naming-convention */
const ISSUE_WRITE_COMMANDS: Record<string, CommandEntry> = {
	'issue:comment': {
		script: 'scripts/issue/issue-comment-main.ts',
		description: 'Post one comment to an issue from a file, so no shell expands the body',
		category: 'AI tools',
		reference: ['<issue> --body <text> | --body-file <path>', 'automation', ['network']],
		usage: {
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
	},
	'issue:plan': {
		script: 'scripts/issue/issue-plan-cli.ts',
		description:
			'Record a plan: normalize the title, fill a blank body or comment, apply run:planned',
		category: 'AI tools',
		reference: [
			'<issue> --body-file <path> [--title <title>] [--planned] [--repo <owner/name>]',
			'automation',
			['network'],
		],
		usage: {
			examples: [
				{
					arguments: '4134 --body-file plan.md --title "Add issue:plan" --planned',
					note: "kickoff's three writes",
				},
			],
			flags: [
				{
					names: [BODY_FILE],
					description:
						'the plan, from a file or stdin (`-`): a blank body takes it, else a comment.',
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
	},
	'issue:already-done': {
		script: 'scripts/issue/issue-already-done-cli.ts',
		description:
			'Exit an issue whose work is already merged: post the evidence, apply already-done, release the hold',
		category: 'AI tools',
		// Releasing the hold runs `run:hold`, which reaches the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: [EVIDENCE_REFERENCE, 'automation', ['network', 'files']],
		usage: {
			examples: [
				{
					arguments: '4130 --evidence-file .josh/tmp/already-done.md',
					note: 'comment, label, release — in that order',
				},
			],
			flags: [
				{
					names: [EVIDENCE_FILE],
					description:
						'the evidence comment: the merging PR or commit and, per acceptance criterion, its `file:line`. An empty file is refused before anything is written.',
				},
			],
		},
	},
	'issue:measured': {
		script: 'scripts/issue/issue-measured-cli.ts',
		description:
			'Complete a measurement-only issue: post the result, label it measured, close it, release the hold',
		category: 'AI tools',
		// Releasing the hold runs `run:hold`, which reaches the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: [EVIDENCE_REFERENCE, 'automation', ['network', 'files']],
		usage: {
			examples: [
				{
					arguments: '4452 --evidence-file .josh/tmp/measured.md',
					note: 'comment, label, close, release — in that order',
				},
			],
			flags: [
				{
					names: [EVIDENCE_FILE],
					description:
						'the result comment: per acceptance criterion, the measurement and the run it came from. An empty file is refused before anything is written.',
				},
			],
		},
	},
	'issue:file': {
		script: 'scripts/issue/issue-file-cli.ts',
		description:
			'File an Issue with every filing step: lint, Origin, filing cap, fold, WIP cap, duplicate scout, labels, then epic:bundle',
		category: 'AI tools',
		reference: [
			'<title> --body-file <path> [--route <route>] [--label <name>] [--repo <owner/repo>] [--distinct <N,…>] [--found-during <N>] [--over-cap] [--no-auto-ok] [--release] [--blocks-finder]',
			'automation',
			['network'],
		],
		usage: {
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
					names: ['--found-during <N>'],
					description:
						'the Issue whose work the filing came from, when it is not the lane or branch Issue. The filing cap counts per origin (step 5); step 7 never holds it as a candidate here.',
				},
				{
					names: ['--over-cap'],
					description: 'the run is blocked by this filing; the WIP cap lets it through.',
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
				{
					names: ['--blocks-finder'],
					description:
						'with `--route interrupt`, the finder cannot go on until this issue is done. The finder is recorded as blocked by the filed issue (step 9); under an epic, `epic --reconcile <E>` after `epic --add` declares it.',
				},
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { ISSUE_WRITE_COMMANDS }
