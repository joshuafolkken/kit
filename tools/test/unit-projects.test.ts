import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { RETRY_PENDING_KEY, RETRY_PENDING_VALUE } from '#scripts/gh/git-gh-comments-unreadable'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { lane_child_mark_keys } from '#scripts/lane/lane-child-mark-keys'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { PURE_FILES } from '#tools/test/pure-files'
import { unit_projects, type UnitProject } from '#tools/test/unit-projects'
import { VITEST_INCLUDE_GLOBS } from '#tools/test/vitest-include-globs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const {
	DEPENDENCY_OPTIMIZER,
	ISOLATED_PROJECT,
	MACHINE_GUARD,
	MAIN_EXCLUDE,
	OPTIMIZED_DEPENDENCIES,
	PURE_PROJECT,
	READ_RECORDER,
	STATE_GUARD,
	STDOUT_GUARD,
	TELEGRAM_GUARD,
	UNIT_PROJECTS,
	unit_environment,
	unit_projects_for,
} = unit_projects

function project(name: string): UnitProject['test'] {
	const found = UNIT_PROJECTS.find((entry) => entry.test.name === name)

	if (found === undefined) throw new Error(`no ${name} project`)

	return found.test
}

// isolate:false is the only reason the split exists; if the pure project ever runs isolated the whole
// change is a no-op that still pays two projects' startup, and if the isolated project runs
// isolate:false a state-mutating test could pass here and fail in CI.
describe('the unit suite splits into a pure and an isolated project', () => {
	it('runs exactly the two projects', () => {
		expect(UNIT_PROJECTS.map((entry) => entry.test.name)).toEqual([PURE_PROJECT, ISOLATED_PROJECT])
	})

	it('runs the pure project without per-file isolation', () => {
		expect(project(PURE_PROJECT).isolate).toBe(false)
	})

	it('keeps the isolated project isolated', () => {
		expect(project(ISOLATED_PROJECT).isolate).toBe(true)
	})
})

// The green condition is identical to the single-project suite only if every included test file lands
// in exactly one project: the pure project runs the classifier's list, and the isolated project runs
// the main globs with that same list excluded, so their union is every included file bar the
// packed-consumer smoke test and nothing runs twice.
describe('the two projects partition the suite without gaps or overlap', () => {
	it('runs the classifier list as the pure project', () => {
		expect(project(PURE_PROJECT).include).toEqual([...PURE_FILES])
	})

	it('runs the main globs as the isolated project', () => {
		expect(project(ISOLATED_PROJECT).include).toEqual([...VITEST_INCLUDE_GLOBS])
	})

	it('excludes every pure file from the isolated project so nothing runs twice', () => {
		for (const file of PURE_FILES) {
			expect(project(ISOLATED_PROJECT).exclude, `${file} runs in both projects`).toContain(file)
		}
	})

	// joshuafolkken/kit#5105: vitest applies a command line's `--exclude` to the root config alone.
	it('adds a command line --exclude to both projects, and nothing without one', () => {
		const excluded = 'tools/test/heavy.test.ts'
		const narrowed = unit_projects_for(['vitest', 'related', '--exclude', excluded, '--run'])

		for (const entry of narrowed) expect(entry.test.exclude).toContain(excluded)

		for (const entry of unit_projects_for(['vitest', 'run'])) {
			expect(entry.test.exclude).not.toContain(excluded)
		}
	})

	it('keeps the packed-consumer smoke test out of both projects', () => {
		expect(project(PURE_PROJECT).include).not.toContain(MAIN_EXCLUDE[0])
		expect(project(ISOLATED_PROJECT).exclude).toEqual(expect.arrayContaining([...MAIN_EXCLUDE]))
	})
})

// Both `globalSetup` entries and `coverage` are read once at the root, so the projects must carry the
// per-run env and timeout themselves or a project would silently run with vitest's defaults.
describe('each project carries the per-run environment and timeout', () => {
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('gives %s the session env and timeout', (name) => {
		expect(project(name).env['CLAUDE_CODE_SESSION_ID']).toBe('vitest-session')
		expect(project(name).testTimeout).toBeGreaterThan(0)
	})

	// joshuafolkken/kit#2436: a package-manager wrapper's loopback proxy would otherwise reach every
	// suite that asserts what a `gh` spawn receives, passing in CI and failing on a wrapped machine.
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('blanks every proxy spelling for %s', (name) => {
		const { env } = project(name)

		for (const key of agent_session_environment.PROXY_KEYS) expect(env[key]).toBe('')
		expect(env[agent_session_environment.PROXY_CERTIFICATE_KEY]).toBe('')
	})

	// joshuafolkken/kit#2456: the pre-push run inside a detached ship supervisor would otherwise send a
	// ship fixture down the supervised stop path.
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('blanks the ship supervisor marks for %s', (name) => {
		const { env } = project(name)

		expect(env[run_ship_detach.SUPERVISED_KEY]).toBe('')
		expect(env[agent_role_profile.HANDED_PROVIDER_KEY]).toBe('')
	})

	// joshuafolkken/kit#3419: a supervisor outliving its session would otherwise record a gone owner on
	// every fixture's hold, which then reads back as stale.
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('blanks the agent session pid for %s', (name) => {
		expect(project(name).env[agent_session_environment.AGENT_PID_KEY]).toBe('')
	})

	// joshuafolkken/kit#3623: a ship reviewer running the suite would otherwise carry its role into every
	// cut-guard delivery fixture, which then stands down where the refusal is expected.
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('blanks the agent session role for %s', (name) => {
		expect(project(name).env[agent_session_role.KEY]).toBe('')
	})
})

// joshuafolkken/kit#5029: the supervisor's retry-pending mark reached the gate's run alone, so a test
// green in the lane's `test:related` went red in the ship's gate.
describe('the unit environment blanks inherited ship and lane marks without a list', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.resetModules()
	})

	it('builds the projects env from the environment the config process inherits', async () => {
		vi.stubEnv(RETRY_PENDING_KEY, RETRY_PENDING_VALUE)
		vi.resetModules()
		const loaded = await import('#tools/test/unit-projects')

		expect(loaded.unit_projects.ENV[RETRY_PENDING_KEY]).toBe('')
	})

	it('blanks the retry-pending mark a ship supervisor sets', () => {
		const environment = unit_environment({ [RETRY_PENDING_KEY]: RETRY_PENDING_VALUE })

		expect(environment[RETRY_PENDING_KEY]).toBe('')
	})

	it('blanks a ship mark it has no entry for, by its prefix alone', () => {
		const environment = unit_environment({ JOSH_SHIP_FUTURE_MARK: '1', JOSH_SESSION_LANG: 'ja' })

		expect(environment['JOSH_SHIP_FUTURE_MARK']).toBe('')
		expect(Object.hasOwn(environment, 'JOSH_SESSION_LANG')).toBe(false)
	})

	it('blanks every mark a lane launcher sets on a child', () => {
		const environment = unit_environment({})

		for (const key of lane_child_mark_keys.MARK_KEYS) expect(environment[key]).toBe('')
	})
})

// joshuafolkken/kit#4301: execa and zod were the suite's two largest import costs, paid again by every
// isolated file; an optimizer without them would silently pay them again.
describe('the dependency optimizer pre-bundles the packages most test files load', () => {
	it('pre-bundles execa and zod', () => {
		const { ssr } = DEPENDENCY_OPTIMIZER.optimizer

		expect(ssr.enabled).toBe(true)
		expect(ssr.include).toEqual([...OPTIMIZED_DEPENDENCIES])
		expect(ssr.include).toEqual(expect.arrayContaining(['execa', 'zod']))
	})

	// A project carrying `deps` (the optimizer) resolves a Vite server of its own instead of sharing the
	// root's, so the optimizer belongs to the root config alone.
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('leaves deps off the %s project', (name) => {
		expect(Object.hasOwn(project(name), 'deps')).toBe(false)
	})
})

// The state guard belongs to the pure project alone: isolate:false is the only run a leaked branch or
// dirty tree reaches a sibling in, and adding it to the isolated project would fail on a state-mutating
// impure test the single-project suite always tolerated.
describe('the state guard is scoped to the pure project', () => {
	it('runs the state guard on the pure project', () => {
		expect(project(PURE_PROJECT).globalSetup).toEqual([...STATE_GUARD])
	})

	it('leaves the isolated project the guards it always had', () => {
		expect(project(ISOLATED_PROJECT).globalSetup).toEqual([])
	})
})

// joshuafolkken/kit#2296: the stdout guard must run inside every worker of both projects, so a
// fixture's direct stream write never leaks into `pnpm josh test:unit`'s output. joshuafolkken/kit#2494
// puts the Telegram guard beside it, since it wraps each worker's own `fetch`, and joshuafolkken/kit#3415
// the machine guard, since it replaces each worker's own machine reading. joshuafolkken/kit#4065
// adds the test-read recorder after them, since a whole-suite run records from every worker.
describe('the per-worker guards run on both projects', () => {
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('sets up every worker guard on %s', (name) => {
		expect(project(name).setupFiles).toEqual([
			...STDOUT_GUARD,
			...TELEGRAM_GUARD,
			...MACHINE_GUARD,
			...READ_RECORDER,
		])
	})
})
