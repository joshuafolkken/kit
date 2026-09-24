import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { run_ship_detach } from '#scripts/run/run-ship-detach'
import { describe, expect, it } from 'vitest'
import { PILOT_FILES } from './pilot-files'
import { unit_projects, type UnitProject } from './unit-projects'
import { VITEST_INCLUDE_GLOBS } from './vitest-include-globs'

const {
	ISOLATED_PROJECT,
	MAIN_EXCLUDE,
	PURE_PROJECT,
	STATE_GUARD,
	STDOUT_GUARD,
	TELEGRAM_GUARD,
	UNIT_PROJECTS,
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
		expect(project(PURE_PROJECT).include).toEqual([...PILOT_FILES])
	})

	it('runs the main globs as the isolated project', () => {
		expect(project(ISOLATED_PROJECT).include).toEqual([...VITEST_INCLUDE_GLOBS])
	})

	it('excludes every pure file from the isolated project so nothing runs twice', () => {
		for (const file of PILOT_FILES) {
			expect(project(ISOLATED_PROJECT).exclude, `${file} runs in both projects`).toContain(file)
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
// puts the Telegram guard beside it, since it wraps each worker's own `fetch`.
describe('the per-worker guards run on both projects', () => {
	it.each([PURE_PROJECT, ISOLATED_PROJECT])('sets up both guards on %s', (name) => {
		expect(project(name).setupFiles).toEqual([...STDOUT_GUARD, ...TELEGRAM_GUARD])
	})
})
