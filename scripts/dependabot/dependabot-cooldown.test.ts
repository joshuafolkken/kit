import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { release_age } from '#scripts/version/release-age'
import {
	DEFAULT_RELEASE_AGE_MINUTES,
	release_window,
	type ReleaseWindow,
} from '#scripts/version/release-window'
import { describe, expect, it } from 'vitest'
import { dependabot_cooldown } from './dependabot-cooldown'

const DAY_MINUTES = 1440
const THREE_DAYS = 3
const MAX_DAYS = 90
const LONG_MINUTES = 1_000_000
const DEPENDABOT_PATH = path.join('.github', 'dependabot.yml')
const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const TYPES_NODE = '@types/node'
const VERSION_LINE = 'version: 2'
const UPDATES_LINE = 'updates:'
const NPM_KEY = 'package-ecosystem: npm'
const THREE_DAY_COOLDOWN = 'default-days: 3'
const EXCLUDED: ReadonlyArray<string> = ['vite', TYPES_NODE]
const THREE_DAY_WINDOW: ReleaseWindow = {
	minutes: DEFAULT_RELEASE_AGE_MINUTES,
	exclusions: EXCLUDED,
}

const ACTIONS_ENTRY = [
	VERSION_LINE,
	UPDATES_LINE,
	'  # actions comment',
	"  - package-ecosystem: 'github-actions'",
	'    directories:',
	"      - '/'",
	'    schedule:',
	"      interval: 'weekly'",
]
const NPM_ENTRY = [
	'',
	'  # npm comment',
	"  - package-ecosystem: 'npm'",
	"    directory: '/'",
	'    open-pull-requests-limit: 0',
]
const COOLDOWN = ['    cooldown:', `      ${THREE_DAY_COOLDOWN}`]
const NPM_EXCLUDE = ['      exclude:', "        - 'vite'", `        - '${TYPES_NODE}'`]

const CONFIG = [...ACTIONS_ENTRY, ...NPM_ENTRY, ''].join('\n')
const EXPECTED = [
	...ACTIONS_ENTRY,
	...COOLDOWN,
	...NPM_ENTRY,
	...COOLDOWN,
	...NPM_EXCLUDE,
	'',
].join('\n')

function read_kit_file(name: string): string {
	return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
}

function with_root(run: (root: string) => void): void {
	const root = mkdtempSync(path.join(tmpdir(), 'dependabot-cooldown-'))

	try {
		mkdirSync(path.join(root, '.github'))
		run(root)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

describe('dependabot_cooldown.cooldown_days', () => {
	it.each([
		[DAY_MINUTES, 1],
		[DAY_MINUTES + 1, 2],
		[DEFAULT_RELEASE_AGE_MINUTES, THREE_DAYS],
	])('rounds %i minutes up to %i days', (minutes, days) => {
		expect(dependabot_cooldown.cooldown_days(minutes)).toBe(days)
	})

	it('keeps the days within the 1 to 90 Dependabot accepts', () => {
		expect(dependabot_cooldown.cooldown_days(0)).toBe(1)
		expect(dependabot_cooldown.cooldown_days(LONG_MINUTES)).toBe(MAX_DAYS)
	})

	it('uses the three-day default when no window is declared', () => {
		expect(dependabot_cooldown.cooldown_days(undefined)).toBe(THREE_DAYS)
	})
})

describe('dependabot_cooldown.merge_cooldown', () => {
	it('adds a cooldown to every entry, with the exclusions on npm only', () => {
		expect(dependabot_cooldown.merge_cooldown(CONFIG, THREE_DAY_WINDOW)).toBe(EXPECTED)
	})

	it('replaces an existing cooldown and keeps every other key and comment', () => {
		const stale = EXPECTED.replaceAll(THREE_DAY_COOLDOWN, 'default-days: 1').replace(
			"        - '@types/node'\n",
			'',
		)

		expect(dependabot_cooldown.merge_cooldown(stale, THREE_DAY_WINDOW)).toBe(EXPECTED)
	})

	it('is idempotent', () => {
		expect(dependabot_cooldown.merge_cooldown(EXPECTED, THREE_DAY_WINDOW)).toBe(EXPECTED)
	})

	it('reads a list written flush with updates and past a column-0 comment', () => {
		const flush = [UPDATES_LINE, `- ${NPM_KEY}`, '# docker', '- package-ecosystem: docker']
		const window: ReleaseWindow = { minutes: DEFAULT_RELEASE_AGE_MINUTES, exclusions: [] }
		const days = `    ${THREE_DAY_COOLDOWN}`

		expect(dependabot_cooldown.merge_cooldown(flush.join('\n'), window)).toBe(
			[...flush.slice(0, 2), '  cooldown:', days, flush[2], flush[3], '  cooldown:', days].join(
				'\n',
			),
		)
	})

	it('leaves a file without an updates list untouched', () => {
		const content = `${VERSION_LINE}\n`

		expect(dependabot_cooldown.merge_cooldown(content, THREE_DAY_WINDOW)).toBe(content)
	})
})

describe('dependabot_cooldown.merge_cooldown with a leading cooldown', () => {
	it('replaces a cooldown that opens its entry without duplicating the key', () => {
		const leading = [UPDATES_LINE, '  - cooldown:', '      default-days: 7', `    ${NPM_KEY}`]
		const window: ReleaseWindow = { minutes: DEFAULT_RELEASE_AGE_MINUTES, exclusions: [] }

		expect(dependabot_cooldown.merge_cooldown(leading.join('\n'), window)).toBe(
			[UPDATES_LINE, `  - ${NPM_KEY}`, ...COOLDOWN].join('\n'),
		)
	})
})

describe('dependabot_cooldown.merge_cooldown with a shallow comment', () => {
	it('keeps a comment indented left of the keys inside its entry', () => {
		const entry = [UPDATES_LINE, `  - ${NPM_KEY}`, '  # weekly', "    schedule: 'weekly'"]
		const window: ReleaseWindow = { minutes: DEFAULT_RELEASE_AGE_MINUTES, exclusions: [] }

		expect(dependabot_cooldown.merge_cooldown(entry.join('\n'), window)).toBe(
			[...entry, ...COOLDOWN].join('\n'),
		)
	})
})

describe('dependabot_cooldown.sync_dependabot_cooldown', () => {
	it('writes the three-day default when the repository has no pnpm-workspace.yaml', () => {
		with_root((root) => {
			writeFileSync(path.join(root, DEPENDABOT_PATH), CONFIG)

			expect(dependabot_cooldown.sync_dependabot_cooldown(root)).toBe(true)
			expect(readFileSync(path.join(root, DEPENDABOT_PATH), 'utf8')).toContain(THREE_DAY_COOLDOWN)
			expect(dependabot_cooldown.sync_dependabot_cooldown(root)).toBe(false)
		})
	})

	it('derives the days and exclusions from the workspace window', () => {
		with_root((root) => {
			writeFileSync(path.join(root, DEPENDABOT_PATH), CONFIG)
			writeFileSync(
				path.join(root, WORKSPACE_FILE),
				'minimumReleaseAge: 4320\nminimumReleaseAgeExclude:\n  - vite\n  - "@types/node"\n',
			)
			dependabot_cooldown.sync_dependabot_cooldown(root)

			expect(readFileSync(path.join(root, DEPENDABOT_PATH), 'utf8')).toBe(EXPECTED)
		})
	})

	it('writes nothing when the repository has no dependabot.yml', () => {
		with_root((root) => {
			expect(dependabot_cooldown.sync_dependabot_cooldown(root)).toBe(false)
		})
	})
})

describe('kit release window', () => {
	const workspace = read_kit_file(WORKSPACE_FILE)

	it('declares the default three-day window', () => {
		expect(release_age.parse_minimum_release_age(workspace)).toBe(DEFAULT_RELEASE_AGE_MINUTES)
	})

	it('keeps the distributed dependabot.yml cooldown in step with the workspace', () => {
		const config = read_kit_file(DEPENDABOT_PATH)
		const window = release_window.parse_release_window(workspace)

		expect(dependabot_cooldown.merge_cooldown(config, window)).toBe(config)
	})
})
