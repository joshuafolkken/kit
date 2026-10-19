import path from 'node:path'
import { yaml_config_fixture } from '#scripts/lib/yaml-config-fixture'
import { describe, expect, it } from 'vitest'

// `templates/dependabot.yml` is distributed to every consumer as `.github/dependabot.yml`, and kit's
// own `.github/dependabot.yml` differs from it only by grouping its github-actions bumps, so the
// shared assertions guard the policy for the whole distribution, not just this repository.
// Dependabot spells its keys in kebab-case; they are declared verbatim — with the naming rule
// disabled on the line, as in ci-yml-fixture — rather than reached through an index signature,
// which would turn a misspelled key into `undefined` and make an assertion pass without testing.
interface DependabotGroup {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Dependabot config key
	'update-types'?: ReadonlyArray<string>
}

interface DependabotUpdate {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Dependabot config key
	'package-ecosystem'?: string
	schedule?: { interval?: string }
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Dependabot config key
	'open-pull-requests-limit'?: number
	groups?: Record<string, DependabotGroup>
}

interface DependabotConfig {
	updates?: ReadonlyArray<DependabotUpdate>
}

const CONFIG_FILE = 'dependabot.yml'
const KIT_PATH = path.join('.github', CONFIG_FILE)
const TEMPLATE_PATH = path.join('templates', CONFIG_FILE)
const NPM_ECOSYSTEM = 'npm'
const ACTIONS_ECOSYSTEM = 'github-actions'
const WEEKLY = 'weekly'
const VERSION_UPDATES_DISABLED = 0
const MINOR_AND_PATCH: ReadonlyArray<string> = ['minor', 'patch']

function find_entry(config_path: string, ecosystem: string): DependabotUpdate | undefined {
	const config = yaml_config_fixture.load_yaml_config(config_path) as DependabotConfig

	return config.updates?.find((entry) => entry['package-ecosystem'] === ecosystem)
}

describe.each([KIT_PATH, TEMPLATE_PATH])('%s npm entry (kit#803)', (config_path) => {
	const npm_entry = find_entry(config_path, NPM_ECOSYSTEM)

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

describe.each([KIT_PATH, TEMPLATE_PATH])('%s github-actions entry (kit#803)', (config_path) => {
	const actions_entry = find_entry(config_path, ACTIONS_ECOSYSTEM)

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

// joshuafolkken/kit#3916 lost its auto-merge: two separate bumps to `ci.yml` merged first, so its
// merge commit wrote workflow content its head did not hold, which `GITHUB_TOKEN` may not.
describe('github-actions grouping (kit#4148)', () => {
	it('groups every minor and patch bump of kit into one pull request', () => {
		const groups = Object.values(find_entry(KIT_PATH, ACTIONS_ECOSYSTEM)?.groups ?? {})

		expect(groups.map((group) => group['update-types'])).toStrictEqual([MINOR_AND_PATCH])
	})

	// A consumer's auto-merge holds a whole pull request that touches an upstream-managed workflow,
	// so a group would hold back the consumer-owned bumps that merge on their own today.
	it('leaves the distributed template ungrouped', () => {
		expect(find_entry(TEMPLATE_PATH, ACTIONS_ECOSYSTEM)?.groups).toBeUndefined()
	})
})
