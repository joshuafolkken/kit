import { OPTIONAL_ENV_FILE_FLAGS, type CommandEntry } from './josh-command-types'

const REPO = '--repo <owner/repo>'
const BODY_FILE = '--body-file <path>'
const TITLE = '--title <title>'
const EVIDENCE_FILE = '--evidence-file <path>'
const BLOCKS_FINDER = '--blocks-finder'
const DISTINCT = '--distinct <N,…>'
const EVIDENCE_REFERENCE = `<issue> ${EVIDENCE_FILE}`

// The commands that write to an issue — comment, plan, already-done, measured and file — split out of
// `josh-commands-issue.ts` when each command's usage moved onto its entry (#4185). `ISSUE_COMMANDS`
// spreads this in at the same place, so the map keeps its order.

const ISSUE_WRITE_COMMANDS: Record<string, CommandEntry> = {
	'issue:tick': {
		script: 'scripts/issue/issue-tick-cli.ts',
		description: 'Tick selected acceptance checkboxes by their plan identifiers',
		category: 'AI tools',
		reference: ['<issue> <ac-id>...', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '6233 ac-a1f32a2f ac-8647b0dd' }],
		},
	},
	'issue:consolidate': {
		script: 'scripts/issue/issue-consolidate-cli.ts',
		description:
			'Fold duplicates into a target: untrack, close as not planned; a failed write lists the writes done',
		category: 'AI tools',
		reference: [
			'<target> <duplicate>... [--title <title>] [--body-file <path>] [--demote]',
			'automation',
			['network'],
		],
		usage: {
			examples: [{ arguments: '6559 6567 6568 --body-file .josh/tmp/body.md --demote' }],
			flags: [
				{ names: [TITLE], description: "replace the target's title." },
				{
					names: [BODY_FILE],
					description:
						"replace the target's body, from a file or stdin (`-`). Target author needs write access.",
				},
				{
					names: ['--demote'],
					description:
						'remove the `epic` label and the `## Split into children` sections from the body.',
				},
			],
		},
	},
	'issue:release-class': {
		script: 'scripts/issue/issue-release-class-cli.ts',
		description:
			"Write the issue body's one release classification line, replacing any earlier one",
		category: 'AI tools',
		reference: ['<issue> <enhancement|other-change>', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '6636 other-change' }],
		},
	},
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
	'issue:body': {
		script: 'scripts/issue/issue-body-cli.ts',
		description: "Replace an issue's body with a file that passes issue:lint",
		category: 'AI tools',
		reference: ['<issue> --body-file <path>', 'automation', ['network']],
		usage: {
			examples: [{ arguments: '6982 --body-file .josh/tmp/issue-6982-body.md' }],
			flags: [
				{
					names: [BODY_FILE],
					description:
						'the new body, from a file or stdin (`-`). A body `issue:lint` refuses is not written.',
				},
			],
		},
	},
	'issue:plan': {
		script: 'scripts/issue/issue-plan-cli.ts',
		description:
			'Record a plan: normalize the title, fill a blank body or comment, apply run:planned',
		category: 'AI tools',
		// `--planned` sends the `planning` Telegram (issue-plan-notify.ts), which reads `.env`.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: [
			'<issue> --body-file <path> [--title <title>] [--planned] [--no-notify] [--repo <owner/name>]',
			'automation',
			['network'],
		],
		usage: {
			examples: [
				{
					arguments: '4134 --body-file .josh/tmp/plan.md --title "Add issue:plan" --planned',
					note: "kickoff's three writes",
				},
			],
			flags: [
				{
					names: [BODY_FILE],
					description:
						'the plan, from a file or stdin (`-`): a blank body takes it, else a comment.',
				},
				{ names: [TITLE], description: 'replace the issue title first.' },
				{
					names: ['--planned'],
					description:
						'apply `run:planned` once the plan is posted, so the next entry skips planning; send the `planning` Telegram (change items, `Next:`).',
				},
				{
					names: ['--no-notify'],
					description: 'with `--planned`, skip the `planning` Telegram.',
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
			'Exit an issue whose work is already merged: post the evidence, close it (cited merge) or apply already-done, release the hold',
		category: 'AI tools',
		// Releasing the hold runs `run:hold`, which reaches the stop confirmation.
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		reference: [EVIDENCE_REFERENCE, 'automation', ['network', 'files']],
		usage: {
			examples: [
				{
					arguments: '4130 --evidence-file .josh/tmp/already-done.md',
					note: 'comment, close or label, release — in that order',
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
		reference: [`${EVIDENCE_REFERENCE} [--unmet]`, 'automation', ['network', 'files']],
		usage: {
			examples: [
				{
					arguments: '4452 --evidence-file .josh/tmp/measured.md',
					note: 'comment, label, close, release — in that order',
				},
				{
					arguments: '4452 --unmet --evidence-file .josh/tmp/measured.md',
					note: 'the measurement fell short of the expected effect: measured:unmet as well',
				},
			],
			flags: [
				{
					names: [EVIDENCE_FILE],
					description:
						'the result comment: per acceptance criterion, the measurement and the run it came from. An empty file is refused before anything is written.',
				},
				{
					names: ['--unmet'],
					description:
						'the measurement fell short of the expected effect it checked; adds the measured:unmet label `josh effect:audit` reads',
				},
			],
		},
	},
	'issue:file': {
		script: 'scripts/issue/issue-file-main.ts',
		description:
			'File an Issue: filing cap, fold, one pass naming each refusal (lint, Origin, auto-ok, start condition, WIP cap, scout), labels, epic:bundle',
		category: 'AI tools',
		reference: [
			'<title> --body-file <path> | --batch <dir|file> [--route <route>] [--label <name>] [--defect yes|no|unknown] [--verification yes|no|unknown] [--every-run yes|no|unknown] [--repo <owner/repo>] [--distinct <N,…>] [--found-during <N>] [--over-cap] [--no-auto-ok] [--release] [--blocks-finder] [--check]',
			'automation',
			['network'],
		],
		usage: {
			examples: [
				{ arguments: '"<title>" --body-file .josh/tmp/body.md' },
				{
					arguments:
						'"<title>" --body-file .josh/tmp/body.md --route tier-a --repo joshuafolkken/kit',
				},
				{ arguments: '"<title>" --body-file .josh/tmp/body.md --distinct 2801,2795' },
				{ arguments: '--batch .josh/tmp/deferred --route tier-a' },
				{ arguments: '--batch .josh/tmp/deferred.md --route tier-a' },
			],
			flags: [
				{ names: [BODY_FILE], description: 'the body. Required unless `--batch`.' },
				{
					names: ['--batch <dir|file>'],
					description:
						'file each `*.md` in `<dir>` by name, or each `%%%`-separated part of `<file>`, other flags applied to each; every scout report prints once before the first filing. Title: front matter `title:`, else the first line; front matter `distinct: <N,…>` is its `--distinct`. A refused filing stays unfiled, the rest are filed, the summary names each; any refusal exits 1.',
				},
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
					names: ['--defect / --verification / --every-run <yes|no|unknown>'],
					description:
						'`--label run:solo` requires all three `yes`: a verification defect affecting unrelated PRs every run. Missing, invalid, `no` or `unknown` answers file nothing; success comments the three answers on the issue.',
				},
				{
					names: [REPO],
					description: 'the target repository. Defaults to this repository.',
				},
				{
					names: [DISTINCT],
					description: 'duplicate candidates you read and judged distinct.',
				},
				{
					names: ['--found-during <N>'],
					description:
						'the Issue whose work the filing came from, when it is not the lane or branch Issue. The filing cap counts per origin (step 2); step 7 never holds it as a candidate here. #N gets a deferral comment.',
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
					names: [BLOCKS_FINDER],
					description:
						'with `--route interrupt`, the finder cannot go on until this issue is done. The finder is recorded as blocked by the filed issue (step 9); under an epic, `epic --reconcile <E>` after `epic --add` declares it.',
				},
				{
					names: ['--check'],
					description: 'run steps 1–7, create nothing; exit 1 on a refusal. `--batch` refuses it.',
				},
			],
		},
	},
	'issue:spill': {
		script: 'scripts/issue/issue-spill-main.ts',
		description:
			"Move an issue's unchecked acceptance criteria into a follow-up filed by `issue:file --route split`, placed after it in its epic (or a new one), leaving one link line",
		category: 'AI tools',
		reference: [
			`<issue> --estimate "<F> ファイル / <L> 行" [--reason "<理由>"] [${DISTINCT}]`,
			'automation',
			['network'],
		],
		usage: {
			examples: [{ arguments: '5999 --estimate "3 ファイル / 80 行"' }],
			flags: [
				{
					names: ['--estimate "<F> ファイル / <L> 行"'],
					description:
						"the follow-up's size estimate, never apportioned from the issue's. Required.",
				},
				{
					names: ['--reason "<理由>"'],
					description:
						"the follow-up's `- 分割しない理由:` line, the only excuse from the implement budget; the issue's own is not carried over.",
				},
				{
					names: [DISTINCT],
					description:
						'duplicate candidates `issue:file` held the follow-up on, declared separate; the issue itself always is. Repeatable.',
				},
			],
		},
	},
	'upstream:interrupt': {
		script: 'scripts/issue/upstream-interrupt-main.ts',
		description:
			'Stop for a defect in another package in one call: stash, file the upstream issue, backlink it on the finder, send the confirmation',
		category: 'AI tools',
		reference: [
			`<finder> <title> ${REPO} ${BODY_FILE} [--blocks-finder]`,
			'automation',
			['git', 'network', 'notifications'],
		],
		tsx_arguments: OPTIONAL_ENV_FILE_FLAGS,
		usage: {
			examples: [
				{
					arguments:
						'2304 "<root-cause title>" --repo joshuafolkken/kit --body-file .josh/tmp/body.md',
				},
			],
			flags: [
				{ names: [REPO], description: 'the upstream repository. Required.' },
				{ names: [BODY_FILE], description: 'the upstream issue body. Required.' },
				{
					names: [BLOCKS_FINDER],
					description: 'passed to `issue:file`: the finder is recorded as blocked by the filing.',
				},
			],
		},
	},
}

export { ISSUE_WRITE_COMMANDS }
