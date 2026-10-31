import type { CommandEntry } from './josh-command-types'

const LEVEL_ONLY = '--level-only'
const CHECK = '--check'
const MACHINE_READABLE = 'the verdict and the reason, machine-readable'
const JSON_FLAG = '--json'
const RECORD = '--record'

// The review and delegation commands, split out of `josh-commands-ai.ts` when each command's usage
// moved onto its entry (#4185). `AI_COMMANDS` spreads this in at the same place, so the map keeps its
// order.

/* eslint-disable @typescript-eslint/naming-convention */
const REVIEW_COMMANDS: Record<string, CommandEntry> = {
	'review:brief': {
		script: 'scripts/review/review-brief-main.ts',
		description:
			'Print the whole /code-review invocation: level, what the gate already proved, target (--level-only for the level alone)',
		category: 'AI tools',
		reference: [
			'[--round <1|2>] | --interaction | --level-only [--staged] [--json]',
			'automation',
			['files'],
		],
		usage: {
			examples: [
				{ arguments: '', note: 'round 1' },
				{ arguments: '--round 2', note: 'verification pass, scoped to the fix delta' },
				{ arguments: '--interaction', note: 'the interaction review of a run-tooling change' },
				{ arguments: LEVEL_ONLY, note: 'the level alone (pre-commit review)' },
				{ arguments: '--level-only --json', note: 'level and reason, machine-readable' },
			],
			flags: [
				{
					names: ['--round 2'],
					description:
						"target is round 1's fixes and nothing else (widened back to the whole change when the record's change base no longer matches).",
				},
				{
					names: [LEVEL_ONLY],
					description:
						'print the level alone (level to stdout, reason to stderr); bypasses the scoped-green refusal.',
				},
				{
					names: ['--staged', '--json'],
					description: 'the staged diff; machine-readable level and reason.',
				},
			],
		},
	},
	'review:attest': {
		script: 'scripts/review/review-attest-cli.ts',
		description: 'Record, or verify, which checkout a /code-review actually read',
		category: 'AI tools',
		reference: ['<nonce> | --check', 'automation', ['files']],
		usage: {
			examples: [
				{ arguments: '<nonce>', note: 'run by the review, from the checkout it read' },
				{ arguments: CHECK, note: 'run by the run, before it acts on the review' },
			],
			flags: [
				{ names: ['<nonce>'], description: 'attest the checkout the review read.' },
				{
					names: [CHECK],
					description: 'verify before acting; `josh followup` asks again before merging.',
				},
			],
		},
	},
	'review:submit': {
		script: 'scripts/review/review-submit-cli.ts',
		description:
			"Write a reviewer's findings, read from stdin, where the ship or review:record --from-slot reads them",
		category: 'AI tools',
		reference: ['[--interaction] < findings | [--interaction] --none', 'automation', ['files']],
		usage: {
			examples: [
				{ arguments: '< findings.txt', note: 'the /code-review slot' },
				{ arguments: '--interaction < findings.txt', note: 'the interaction review slot' },
				{ arguments: '--none', note: 'a review with no findings' },
			],
			flags: [
				{
					names: ['--none'],
					description: 'a review with no findings; empty stdin without it is refused.',
				},
			],
		},
	},
	// The self-check's "Prose matches the code" as a search: each word the diff removed that prose still names.
	'prose:stale': {
		script: 'scripts/review/prose-stale-cli.ts',
		description:
			'List each removed declared or exported name, josh command, UPPER_CASE constant or .md heading that docs, prompts or comments still name',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: {
			examples: [
				{
					arguments: '',
					note: '→ `file:line kind word` per reference, or `ok` (exit 1 / 0; 2 on a failure)',
				},
			],
		},
	},
	'review:selfcheck': {
		script: 'scripts/review/selfcheck-cli.ts',
		description:
			'Answer the pre-commit self-check questions 2, 4 and 10 — stale prose, untouched readers, new command examples run — in one command',
		category: 'AI tools',
		reference: ['', 'automation', ['files', 'processes']],
		usage: {
			examples: [
				{
					arguments: '',
					note: '→ `file:line` per finding, then one `selfcheck: pass|fail` line (exit 0 / 1; 2 on a failure)',
				},
			],
		},
	},
	'review:round2': {
		script: 'scripts/review/review-round2-cli.ts',
		description: 'Say whether the second /code-review round is due, or may be skipped entirely',
		category: 'AI tools',
		reference: ['[--record <N>] [--json]', 'automation', ['network']],
		usage: {
			examples: [
				{ arguments: '', note: '→ required | skip, for the branch’s issue' },
				{ arguments: `${RECORD} 123`, note: '→ required | skip, a skip commented on that issue' },
				{ arguments: JSON_FLAG, note: MACHINE_READABLE },
			],
			flags: [
				{
					names: [RECORD],
					description:
						'the issue whose ledger dispositions decide round 1’s closure — skip only when every High/Medium is `fixed` or `false-positive` — and where a skip is commented under `## Round 2 skipped`, once.',
				},
				{ names: [JSON_FLAG], description: 'machine-readable verdict and reason.' },
			],
		},
	},
	delegate: {
		script: 'scripts/delegation/delegation-cli.ts',
		description: 'Say whether a run step may go to a cheaper execution tier',
		category: 'AI tools',
		reference: ['<step> | --list', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: 'gate-fix', note: '→ delegate' },
				{ arguments: 'review', note: '→ keep' },
				{ arguments: '--list', note: 'the enumeration, and what was rejected and why' },
			],
		},
	},
	fanout: {
		script: 'scripts/delegation/fanout-cli.ts',
		description:
			'Say whether proposed implementation units are file-disjoint, so they may run in parallel',
		category: 'AI tools',
		reference: ['<unit-files> <unit-files> [<unit-files> …]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: 'scripts/a.ts,scripts/a.test.ts scripts/b.ts', note: '→ parallel' },
				{
					arguments: 'scripts/a.ts,shared.ts scripts/b.ts,shared.ts',
					note: '→ serial (units share shared.ts)',
				},
				{ arguments: 'scripts/a.ts', note: '→ serial (fewer than two units)' },
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { REVIEW_COMMANDS }
