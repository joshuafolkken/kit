import { ports } from '#ports'
import type { CommandUsage } from './josh-command-types'

// The usage of the commands `docs/josh-commands.md` documents, keyed by command name. The page's
// usage blocks are generated from this table and `josh help <command>` prints it, so an example or a
// flag is written once, here (#3932).
// The unseeded ports are read from `ports/index.js`, their one definition (#818).
const UNSEEDED: Readonly<Record<string, string | undefined>> = {}
const NARROWED = { arguments: 'scripts/thing.ts', note: 'narrow by the given files instead' }

/* eslint-disable @typescript-eslint/naming-convention */
const DEVELOPER_USAGE: Readonly<Record<string, CommandUsage>> = {
	gate: {
		examples: [
			{ arguments: '' },
			{ arguments: '--verbose', note: "every check's output, passing ones included" },
			{ arguments: '--force', note: 're-run even on a tree already recorded green' },
			{ arguments: '--no-unit', note: 'the static checks only (CI only)' },
		],
	},
	lint: { examples: [{ arguments: '' }] },
	'lint:related': { examples: [{ arguments: '' }, NARROWED] },
	lines: {
		examples: [{ arguments: 'scripts/hooks/format-edited-file.ts scripts/josh/josh-logic.ts' }],
	},
	bytes: {
		examples: [
			{ arguments: 'docs/josh-commands.md', note: 'one document' },
			{ arguments: '', note: 'scan: every budgeted document near its ceiling' },
		],
	},
	metrics: {
		examples: [
			{ arguments: '', note: "print the totals and check them against the merge-base's" },
			{ arguments: '--accept --reason "<why>"', note: "record this branch's growth and why" },
		],
	},
	format: { examples: [{ arguments: '' }] },
	'cspell:dot': { examples: [{ arguments: '', note: 'includes dotfiles' }] },
	behavior: { examples: [{ arguments: '' }] },
	'exports:unused': { examples: [{ arguments: '' }] },
	'test:unit': { examples: [{ arguments: '' }] },
	'test:related': {
		examples: [
			{ arguments: '' },
			NARROWED,
			{ arguments: '--silent', note: 'flags are forwarded to vitest' },
		],
	},
	'test:declared': {
		examples: [
			{ arguments: '' },
			{ arguments: '--match', note: 'check Step 0 declarations on stdin' },
			{ arguments: '--help', note: 'print usage, including the --match stdin form' },
		],
	},
	'test:e2e': { examples: [{ arguments: '' }] },
	test: { examples: [{ arguments: '' }] },
	check: { examples: [{ arguments: '' }] },
	port: {
		examples: [
			{
				arguments: 'dev',
				note: `${String(ports.resolve_development_port(UNSEEDED))} with no seed set`,
			},
			{
				arguments: 'preview',
				note: `${String(ports.resolve_preview_port(UNSEEDED))} with no seed set`,
			},
		],
	},
	profile: { examples: [{ arguments: '' }] },
	init: {
		examples: [
			{
				arguments: '',
				note: 'create/merge config files, install and format (--no-install skips both, --dry-run only prints the plan)',
			},
		],
	},
	'registry:migrate': { examples: [{ arguments: '' }] },
	sync: { examples: [{ arguments: '', note: 'overwrite managed files' }] },
	uninstall: {
		examples: [
			{ arguments: '', note: 'show the plan, then ask' },
			{ arguments: '--yes', note: 'remove without asking' },
		],
	},
	adopt: {
		examples: [
			{ arguments: '' },
			{ arguments: '--dry-run', note: 'report the steps without touching anything' },
		],
		flags: [{ names: ['--dry-run'], description: 'report the plan without writing.' }],
	},
	git: {
		examples: [
			{ arguments: '', note: 'interactive' },
			{ arguments: '-y', note: 'unattended (no TTY required)' },
			{ arguments: '-y "title"', note: 'set commit message prefix' },
			{ arguments: '-y "<title> #<N>"', note: 'follow-up commit on the same branch' },
			{
				arguments: '-y --skip-commit --skip-push',
				note: 'open the PR without committing/pushing',
			},
		],
		flags: [
			{
				names: ['-y', '--yes'],
				description: 'run non-interactively; works without a TTY (agent or CI shell).',
			},
			{
				names: ['--skip-commit', '--skip-push'],
				description: 'recover/open a PR without a new commit or push.',
			},
		],
	},
	pr: { examples: [{ arguments: '', note: 'open the PR for the current <N>-<slug> branch' }] },
	'review:findings': { examples: [{ arguments: '' }] },
	'main:sync': { examples: [{ arguments: '' }] },
	'main:merge': { examples: [{ arguments: '' }] },
	version: {
		examples: [
			{ arguments: '' },
			{
				arguments: '--upgrade',
				note: 'upgrade global + project to latest, then re-run fix-gh-packages',
			},
		],
		flags: [
			{
				names: ['--upgrade'],
				description:
					'upgrade both the global install (`pnpm add -g`) and the project devDependency (`pnpm add -D` + `fix-gh-packages`); already-current or not-installed targets are skipped.',
			},
		],
	},
	ranges: { examples: [{ arguments: '' }] },
	doctor: {
		examples: [
			{ arguments: '', note: 'diagnose only' },
			{ arguments: '--fix', note: 'reclaim the global josh by removing a stale kit shim' },
			{ arguments: '--ports', note: 'also print the per-repository port-seed table' },
		],
		flags: [
			{
				names: ['--fix'],
				description:
					'remove a shadowing binary **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script); any other binary is left and reported for manual review. Also the one-shot recovery for an old project that re-created the global shim.',
			},
			{ names: ['--ports'], description: 'additionally print the port-seed table (see below).' },
		],
	},
	audit: { examples: [{ arguments: '' }] },
	overrides: {
		examples: [
			{ arguments: '', note: 'verify overrides unchanged' },
			{ arguments: '--save', note: 'snapshot current merged overrides' },
		],
		flags: [
			{
				names: ['--save'],
				description:
					'write the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.',
			},
		],
	},
	backlogrun: {
		examples: [
			{ arguments: '', note: 'start in Claude, then show the board' },
			{ arguments: '3437 --only', note: 'the arguments go to backlogrun as typed' },
			{ arguments: '--agent codex', note: 'start in Codex' },
			{ arguments: '--stop', note: 'stop the run in this repository' },
		],
	},
	'lane:limit': {
		examples: [
			{ arguments: '8', note: "raise or lower the live run's limit to 8" },
			{ arguments: '', note: 'print the limit, the lanes in use and the free lanes' },
			{ arguments: '--reset', note: 'clear the override; JOSH_LANE_LIMIT applies again' },
		],
	},
	'lane:withdraw': {
		examples: [{ arguments: '3769 --reason "folded into a broader issue"' }],
	},
	'rule:value': {
		examples: [
			{ arguments: '' },
			{
				arguments: '--refresh',
				note: 'write the reading to the loop-head cache instead of stdout',
			},
		],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { DEVELOPER_USAGE }
