import path from 'node:path'
import { ci_yml_fixture, type WorkflowStep } from '#scripts/ci/ci-yml-fixture'
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
	patterns?: ReadonlyArray<string>
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
const PUBLISH_GROUP = 'publish-actions'
// The remaining group is named after its ecosystem.
const ACTIONS_GROUP = ACTIONS_ECOSYSTEM

// The jobs that hold publish credentials, and the `pack` job that builds the tarball they publish
// byte for byte (joshuafolkken/kit#4654).
const PUBLISH_WORKFLOW = path.join('.github', 'workflows', 'publish.yml')
const PUBLISH_JOBS: ReadonlyArray<string> = ['pack', 'publish-github', 'publish-npm']
const LOCAL_ACTION_PREFIX = './'
const ACTION_FILE = 'action.yml'
// An action only a local composite action runs, so the resolver is shown to follow them.
const COMPOSITE_ONLY_ACTION = 'pnpm/setup'
const REPOSITORY_SEGMENTS = 2

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function local_action(step: WorkflowStep): string | undefined {
	if (step.uses?.startsWith(LOCAL_ACTION_PREFIX) !== true) return undefined

	return path.join(step.uses, ACTION_FILE)
}

// A local composite action is replaced by the steps it runs, so an action it adds is counted too.
function resolve_steps(steps: ReadonlyArray<WorkflowStep>): ReadonlyArray<WorkflowStep> {
	return steps.flatMap((step) => {
		const action_file = local_action(step)

		if (action_file === undefined) return [step]

		return resolve_steps(ci_yml_fixture.load_action(action_file).runs.steps)
	})
}

// Dependabot names an action by its repository, so `actions/cache/restore` is the `actions/cache`
// dependency (joshuafolkken/kit#5315).
function action_repository(step: WorkflowStep): string {
	return ci_yml_fixture.action_name(step).split('/').slice(0, REPOSITORY_SEGMENTS).join('/')
}

function publish_actions(): ReadonlyArray<string> {
	const job_steps = PUBLISH_JOBS.flatMap(
		(job) => ci_yml_fixture.find_job(PUBLISH_WORKFLOW, job)?.steps ?? [],
	)
	const names = resolve_steps(job_steps)
		.filter((step) => step.uses !== undefined)
		.map((step) => action_repository(step))

	return [...new Set(names)].toSorted(by_name)
}

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
	// The publish-credential actions come first so Dependabot files them in their own pull request,
	// which the auto-merge workflow leaves to a person (joshuafolkken/kit#4633).
	it('groups every minor and patch bump of kit into the publish and the remaining group', () => {
		const groups = find_entry(KIT_PATH, ACTIONS_ECOSYSTEM)?.groups ?? {}

		expect(Object.keys(groups)).toStrictEqual([PUBLISH_GROUP, ACTIONS_GROUP])
		expect(Object.values(groups).map((group) => group['update-types'])).toStrictEqual([
			MINOR_AND_PATCH,
			MINOR_AND_PATCH,
		])
	})

	// An action missing from the list would fall into the auto-merged group, and a stale one would
	// hold a bump back from it, so the list is exactly the actions those jobs run
	// (joshuafolkken/kit#4633, joshuafolkken/kit#4654).
	it('lists exactly the actions the pack and publish jobs run in the publish group', () => {
		const patterns = find_entry(KIT_PATH, ACTIONS_ECOSYSTEM)?.groups?.[PUBLISH_GROUP]?.patterns

		expect(patterns?.toSorted(by_name)).toStrictEqual(publish_actions())
	})

	it('follows the local composite actions those jobs set up through', () => {
		expect(publish_actions()).toContain(COMPOSITE_ONLY_ACTION)
	})

	// A consumer's auto-merge holds a whole pull request that touches an upstream-managed workflow,
	// so a group would hold back the consumer-owned bumps that merge on their own today.
	it('leaves the distributed template ungrouped', () => {
		expect(find_entry(TEMPLATE_PATH, ACTIONS_ECOSYSTEM)?.groups).toBeUndefined()
	})
})
