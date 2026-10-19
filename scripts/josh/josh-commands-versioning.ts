import type { CommandEntry } from './josh-command-types'

/* eslint-disable @typescript-eslint/naming-convention */
const VERSIONING_COMMANDS: Record<string, CommandEntry> = {
	bump: {
		script: 'scripts/version/bump-version.ts',
		description: 'Bump package version',
		category: 'Versioning',
		reference: ['[major|minor|patch]', 'maintainer', ['files']],
		usage: { examples: [{ arguments: 'major' }, { arguments: 'minor' }, { arguments: 'patch' }] },
	},
	version: {
		script: 'scripts/version/version-check.ts',
		description: 'Show kit versions; --upgrade updates the global and project install',
		category: 'Versioning',
		reference: ['[--upgrade]', 'developer', ['files', 'network', 'processes']],
		usage: {
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
	},
	// A `script` entry, not a shell one: script paths resolve against the kit package root, so this
	// keeps working from a consumer repo where the file lives under node_modules. The registry
	// probes need NODE_AUTH_TOKEN for any `@joshuafolkken/*` dependency; `josh latest` exports it
	// before chaining here, exactly as it already does for `latest:update`.
	ranges: {
		script: 'scripts/version/publishable-range-check.ts',
		description:
			'Check that every published dependency range still resolves for a consumer and no peer range falls below an installed toolkit',
		category: 'Versioning',
		reference: ['', 'developer', ['network']],
		usage: { examples: [{ arguments: '' }] },
	},
	// The one place that decides a version. A `script` entry for the same
	// reason `ranges` is one: script paths resolve against the kit package root, so it keeps working
	// from a consumer repository where the file lives under node_modules.
	release: {
		script: 'scripts/release/release-cli.ts',
		description: 'Release the merges main has taken since the version last changed',
		category: 'Versioning',
		reference: ['[--dry-run]', 'maintainer', ['git', 'network', 'release']],
		usage: {
			examples: [
				{ arguments: '' },
				{ arguments: '--dry-run', note: 'count and report, write nothing' },
			],
			flags: [
				{
					names: ['--dry-run'],
					description:
						'count and report only; writes nothing, fetches nothing, and creates no work tree.',
				},
				{
					names: ['--help', '-h'],
					description:
						'print the usage line and exit 0 without fetching or releasing. Any other argument is refused with the usage line and a non-zero exit, before anything is fetched.',
				},
			],
		},
	},
	// The read-only half of the one above. `release --dry-run` cannot
	// answer this question: it refuses off the default branch and on a dirty tree, which is every
	// position a run asks it from. A `script` entry for the same reason `release` is one.
	'release:scope': {
		script: 'scripts/release/release-scope-cli.ts',
		description: 'Say whether a release is owed, from the unreleased merges on main',
		category: 'Versioning',
		reference: ['[--json]', 'automation', ['none']],
		usage: {
			examples: [
				{ arguments: '', note: '→ required | skip | unknown' },
				{ arguments: '--json', note: '{"scope":"…","reason":"…"} on one line' },
			],
		},
	},
	// Run by the release workflows, kit's and the one sync distributes, after a tag has published.
	// Settings come from the environment, so the workflow decides them.
	'release:github': {
		script: 'scripts/release/github-release-cli.ts',
		description: 'Create the GitHub Release for a published tag, with generated notes',
		category: 'Versioning',
		reference: ['', 'automation', ['network', 'release']],
		usage: {
			examples: [
				{ arguments: '', note: 'run by CI with GH_TOKEN, RELEASE_TAG and GITHUB_REPOSITORY set' },
			],
		},
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { VERSIONING_COMMANDS }
