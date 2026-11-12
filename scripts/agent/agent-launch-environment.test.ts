import { existsSync } from 'node:fs'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT, platform_temporary } from '#scripts/josh/platform-temporary'
import { describe, expect, it } from 'vitest'
import { agent_headless } from './agent-headless'
import { agent_launch_environment } from './agent-launch-environment'
import { agent_role_profile } from './agent-role-profile'
import { agent_session_role } from './agent-session-role'

const MARKER = '2080'
const EXPLICIT_TMPDIR = '/caller/tmp'
const CALLER_HOME = '/caller/codex-home'

describe('OpenAI detached launch environment', () => {
	it('creates TMPDIR under the platform temporary root and outside the work tree', () => {
		const environment = agent_launch_environment.build(agent_role_profile.OPENAI_PROFILES.scheduler)

		expect(environment['TMPDIR']).toBe(PLATFORM_TEMP_ROOT)
		expect(path.relative(process.cwd(), environment['TMPDIR'] ?? '')).toMatch(/^\.\./u)
		expect(existsSync(environment['TMPDIR'] ?? '')).toBe(true)
		expect(platform_temporary.is_writable_directory(environment['TMPDIR'] ?? '')).toBe(true)
	})

	it('keeps an explicit caller TMPDIR', () => {
		const environment = agent_launch_environment.build(agent_role_profile.OPENAI_PROFILES.worker, {
			TMPDIR: EXPLICIT_TMPDIR,
		})

		expect(environment['TMPDIR']).toBe(EXPLICIT_TMPDIR)
	})
})

// joshuafolkken/kit#7196: an OpenAI child reads gh's keyring and the real Codex home as a Claude
// child does, so no launch injects a GH_TOKEN or points CODEX_HOME into the work tree.
describe('OpenAI child credentials', () => {
	it.each(Object.values(agent_role_profile.OPENAI_PROFILES))(
		'passes neither GH_TOKEN nor CODEX_HOME to the $role launch',
		(profile) => {
			const environment = agent_launch_environment.build(profile, {
				JOSH_LANE_CHILD_ISSUE: MARKER,
			})

			expect(environment).not.toHaveProperty('GH_TOKEN')
			expect(environment).not.toHaveProperty('CODEX_HOME')
			expect(environment['JOSH_LANE_CHILD_ISSUE']).toBe(MARKER)
		},
	)

	it('keeps the caller CODEX_HOME for the reviewer launch', () => {
		const environment = agent_launch_environment.build(
			agent_role_profile.OPENAI_PROFILES.reviewer,
			{ CODEX_HOME: CALLER_HOME },
		)

		expect(environment['CODEX_HOME']).toBe(CALLER_HOME)
	})
})

describe('Anthropic detached launch environment', () => {
	it('keeps explicit child environment and adds no OpenAI variables', () => {
		const input = { JOSH_LANE_CHILD_ISSUE: MARKER }

		const environment = agent_launch_environment.build(
			agent_role_profile.DEFAULT_PROFILES.worker,
			input,
		)

		expect(environment).toStrictEqual({
			...agent_headless.environment(),
			...agent_session_role.env_for(agent_role_profile.WORKER),
			...input,
		})
	})
})

// joshuafolkken/kit#3245: the stop rules on reply wording stand down only for agents kit launched.
describe('headless agent mark', () => {
	it.each([
		['Anthropic', agent_role_profile.DEFAULT_PROFILES.reviewer],
		['OpenAI', agent_role_profile.OPENAI_PROFILES.worker],
	])('marks every %s agent launch as headless', (_provider, profile) => {
		expect(agent_headless.is_headless(agent_launch_environment.build(profile))).toBe(true)
	})

	it('leaves a launch with no agent profile unmarked', () => {
		const input = { JOSH_LANE_CHILD_ISSUE: MARKER }

		expect(agent_launch_environment.build(undefined, input)).toEqual({
			...input,
			[agent_session_role.KEY]: undefined,
		})
	})
})

// joshuafolkken/kit#3623: a ship reviewer inherits its launcher's lane mark, so the role is what tells
// it apart from the implementing child — written on every launch, so an inherited value never stands.
describe('agent session role mark', () => {
	it.each(Object.values(agent_role_profile.DEFAULT_PROFILES))(
		'overwrites an inherited worker role with the launcher role $role',
		(profile) => {
			const environment = agent_launch_environment.build(profile, {
				...agent_session_role.env_for(agent_role_profile.WORKER),
			})

			expect(environment[agent_session_role.KEY]).toBe(profile.role)
		},
	)

	it('clears inherited authority without a profile', () => {
		const environment = agent_launch_environment.build(undefined, {
			...agent_session_role.env_for(agent_role_profile.WORKER),
		})

		expect(environment[agent_session_role.KEY]).toBeUndefined()
		expect(agent_session_role.can_implement(environment)).toBe(false)
	})

	it.each([
		['Anthropic', agent_role_profile.DEFAULT_PROFILES.reviewer],
		['OpenAI', agent_role_profile.OPENAI_PROFILES.reviewer],
	])('marks an %s reviewer launch as a reviewer session', (_provider, profile) => {
		expect(agent_session_role.is_reviewer(agent_launch_environment.build(profile))).toBe(true)
	})

	it.each([
		['worker', agent_role_profile.DEFAULT_PROFILES.worker],
		['scheduler', agent_role_profile.OPENAI_PROFILES.scheduler],
	])('marks a %s launch with its own role, not the reviewer one', (role, profile) => {
		const environment = agent_launch_environment.build(profile)

		expect(environment[agent_session_role.KEY]).toBe(role)
		expect(agent_session_role.is_reviewer(environment)).toBe(false)
	})
})
