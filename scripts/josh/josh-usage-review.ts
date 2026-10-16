import type { CommandUsage } from './josh-command-types'

// The usage of the review, delegation and oracle commands `docs/josh-commands-backlog.md` documents
// under "Review, delegation and oracles", keyed by command name. The page's usage blocks are generated
// from this table and `josh help <command>` prints it, so an example or a flag is written once, here
// (#3938).
const MACHINE_READABLE = 'the verdict and the reason, machine-readable'
const LEVEL_ONLY = '--level-only'
const JSON_FLAG = '--json'
const CHECK = '--check'
const ROUND_1_CLOSED = '--round-1-closed'

/* eslint-disable @typescript-eslint/naming-convention */
const REVIEW_USAGE: Readonly<Record<string, CommandUsage>> = {
	'review:brief': {
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
	'review:round2': {
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
	disposition: { examples: [{ arguments: '<path...>', note: '→ runtime | non-runtime' }] },
	'review:attest': {
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
	delegate: {
		examples: [
			{ arguments: 'gate-fix', note: '→ delegate' },
			{ arguments: 'review', note: '→ keep' },
			{ arguments: '--list', note: 'the enumeration, and what was rejected and why' },
		],
	},
	fanout: {
		examples: [
			{ arguments: 'scripts/a.ts,scripts/a.test.ts scripts/b.ts', note: '→ parallel' },
			{
				arguments: 'scripts/a.ts,shared.ts scripts/b.ts,shared.ts',
				note: '→ serial (units share shared.ts)',
			},
			{ arguments: 'scripts/a.ts', note: '→ serial (fewer than two units)' },
		],
	},
	'split:assess': {
		examples: [
			{ arguments: '', note: '→ single' },
			{ arguments: JSON_FLAG, note: MACHINE_READABLE },
		],
	},
	'oracle:list': { examples: [{ arguments: '' }] },
	'clone:scan': { examples: [{ arguments: '' }] },
	cases: {
		examples: [
			{ arguments: 'scripts/a.ts scripts/b.ts', note: 'the boundaries these paths cross' },
		],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { REVIEW_USAGE }
