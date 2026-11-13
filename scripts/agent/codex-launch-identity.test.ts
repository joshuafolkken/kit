import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { LaunchRequest } from '#scripts/run/detached-launch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'
import { codex_launch_identity } from './codex-launch-identity'

const ISSUE = '2071'
const LANE = `/work/.kit-lanes/${ISSUE}`
const CUSTOM_ROOT = '/work/custom "quoted" lanes'
const WORKER = agent_role_profile.OPENAI_PROFILES.worker
const PROMPT = `fullrun #${ISSUE}`
const MARK_CONFIG = `shell_environment_policy.set.JOSH_LANE_CHILD="${ISSUE}"`

afterEach(() => vi.unstubAllEnvs())

function request(cwd = LANE): LaunchRequest {
	return {
		argv: codex_agent_argv.build(PROMPT, WORKER, cwd),
		profile: WORKER,
		cwd,
		env: lane_child_marker.env_for(ISSUE),
	}
}

describe('Codex launch identity', () => {
	it('adds only the explicit lane identity while preserving the final prompt and role', () => {
		const launch = request()
		const args = codex_launch_identity.arguments_for(launch)

		expect(args).toContain(MARK_CONFIG)
		expect(args).toContain('shell_environment_policy.set.JOSH_AGENT_ROLE="worker"')
		expect(args.slice(0, -3)).toStrictEqual(launch.argv.args.slice(0, -1))
		expect(args.at(-1)).toBe(PROMPT)
		expect(launch.argv.args).not.toContain(MARK_CONFIG)
	})

	it('carries the configured custom lane root with TOML-safe quoting', () => {
		vi.stubEnv(lane_paths.LANE_ROOT_KEY, CUSTOM_ROOT)
		const args = codex_launch_identity.arguments_for(request(`${CUSTOM_ROOT}/${ISSUE}`))

		expect(args).toContain(MARK_CONFIG)
		expect(args).toContain(
			`shell_environment_policy.set.JOSH_LANE_ROOT=${JSON.stringify(CUSTOM_ROOT)}`,
		)
	})

	it('uses a root explicitly supplied by the launcher over the inherited root', () => {
		vi.stubEnv(lane_paths.LANE_ROOT_KEY, '/other/root')
		const launch = request(`${CUSTOM_ROOT}/${ISSUE}`)

		launch.env = { ...launch.env, JOSH_LANE_ROOT: CUSTOM_ROOT }

		expect(codex_launch_identity.arguments_for(launch)).toContain(MARK_CONFIG)
	})
})

describe('Codex launch identity refusal', () => {
	it.each([
		['main checkout', { cwd: '/work/kit' }],
		['another issue', { env: lane_child_marker.env_for('2072') }],
		['missing explicit mark', { env: {} }],
		['malformed mark', { env: { JOSH_LANE_CHILD: '2071; echo leaked' } }],
		['reviewer', { profile: agent_role_profile.OPENAI_PROFILES.reviewer }],
		['scheduler', { profile: agent_role_profile.OPENAI_PROFILES.scheduler }],
		['Claude worker', { profile: agent_role_profile.DEFAULT_PROFILES.worker }],
		['process without a profile', { profile: undefined }],
	])('adds no identity for %s', (_name, overrides) => {
		vi.stubEnv(lane_child_marker.KEY, ISSUE)
		const launch = { ...request(), ...overrides }

		expect(codex_launch_identity.arguments_for(launch)).toStrictEqual(launch.argv.args)
	})
})

describe('Codex launch identity isolation', () => {
	it('does not forward arbitrary launcher environment or change core inheritance', () => {
		const launch = request()

		launch.env = { ...launch.env, UNRELATED_VALUE: 'private', GH_TOKEN: 'private' }
		const args = codex_launch_identity.arguments_for(launch)

		expect(args.join(' ')).not.toMatch(/UNRELATED_VALUE|GH_TOKEN|inherit=|private/u)
	})

	it('leaves non-Codex supervisor processes unchanged', () => {
		const launch = request()

		launch.argv = { command: process.execPath, args: ['supervisor.js'] }

		expect(codex_launch_identity.arguments_for(launch)).toStrictEqual(launch.argv.args)
	})
})
