import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { yaml_config_fixture } from './yaml-config-fixture'

// `.github/dependabot.yml` is distributed verbatim to every consumer via AI_COPY_FILES, so these
// assertions guard the policy for the whole distribution, not just this repository.
// Dependabot spells its keys in kebab-case; they are declared verbatim — with the naming rule
// disabled on the line, as in ci-yml-fixture — rather than reached through an index signature,
// which would turn a misspelled key into `undefined` and make an assertion pass without testing.
interface DependabotUpdate {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Dependabot config key
	'package-ecosystem'?: string
	schedule?: { interval?: string }
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Dependabot config key
	'open-pull-requests-limit'?: number
}

interface DependabotConfig {
	updates?: ReadonlyArray<DependabotUpdate>
}

const DEPENDABOT_PATH = path.join('.github', 'dependabot.yml')
const NPM_ECOSYSTEM = 'npm'
const ACTIONS_ECOSYSTEM = 'github-actions'
const WEEKLY = 'weekly'
const VERSION_UPDATES_DISABLED = 0

function load_updates(): ReadonlyArray<DependabotUpdate> {
	const config = yaml_config_fixture.load_yaml_config(DEPENDABOT_PATH) as DependabotConfig

	return config.updates ?? []
}

function find_entry(ecosystem: string): DependabotUpdate | undefined {
	return load_updates().find((entry) => entry['package-ecosystem'] === ecosystem)
}

describe('.github/dependabot.yml npm entry (kit#803)', () => {
	const npm_entry = find_entry(NPM_ECOSYSTEM)

	it('declares an npm entry', () => {
		expect(npm_entry).toBeDefined()
	})

	// `josh latest` already bumps npm dependencies at the start of every fullrun / halfrun / queue,
	// so weekly version-update PRs were pure duplication and were closed unmerged. A limit of 0
	// disables version updates only; security advisory PRs keep their own internal limit.
	it('disables version updates so only security advisories open npm PRs', () => {
		expect(npm_entry?.['open-pull-requests-limit']).toBe(VERSION_UPDATES_DISABLED)
	})

	// Dependabot rejects an update entry without a schedule, so the key must survive the change.
	it('keeps the schedule key that Dependabot requires on every entry', () => {
		expect(npm_entry?.schedule?.interval).toBe(WEEKLY)
	})
})

describe('.github/dependabot.yml github-actions entry (kit#803)', () => {
	const actions_entry = find_entry(ACTIONS_ECOSYSTEM)

	it('declares a github-actions entry', () => {
		expect(actions_entry).toBeDefined()
	})

	// This ecosystem is what bumps the action SHA pins that `josh sync` then distributes, so the
	// npm change must not spill over into it.
	it('keeps weekly version updates', () => {
		expect(actions_entry?.schedule?.interval).toBe(WEEKLY)
	})

	// Only a limit of 0 disables updates, so this asserts "not zero" rather than "unset" — a
	// deliberate non-zero throttle stays a valid configuration for this ecosystem.
	it('does not disable version updates', () => {
		expect(actions_entry?.['open-pull-requests-limit']).not.toBe(VERSION_UPDATES_DISABLED)
	})
})
