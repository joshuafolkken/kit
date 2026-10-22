import type { CommandEntry } from './josh-command-types'

const LEVEL_ONLY = '--level-only'
const CHECK = '--check'
const MACHINE_READABLE = 'the verdict and the reason, machine-readable'
const JSON_FLAG = '--json'
const ROUND_1_CLOSED = '--round-1-closed'

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
		reference: ['[--round <1|2>] | --level-only [--staged] [--json]', 'automation', ['files']],
		usage: {
			examples: [
				{ arguments: '', note: 'round 1' },
				{ arguments: '--round 2', note: 'verification pass, scoped to the fix delta' },
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
	'review:round2': {
		script: 'scripts/review/review-round2-cli.ts',
		description: 'Say whether the second /code-review round is due, or may be skipped entirely',
		category: 'AI tools',
		reference: ['[--round-1-closed] [--json]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: '', note: '→ required' },
				{ arguments: ROUND_1_CLOSED, note: '→ required | skip' },
				{ arguments: JSON_FLAG, note: MACHINE_READABLE },
			],
			flags: [
				{
					names: [ROUND_1_CLOSED],
					description:
						'the caller states every round-1 High/Medium finding closed and none was filed or deferred; its absence answers `required`.',
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
