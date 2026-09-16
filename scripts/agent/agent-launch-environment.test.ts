import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { gh_cli_token } from '#scripts/gh/gh-cli-token'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent_launch_environment } from './agent-launch-environment'
import { agent_role_profile } from './agent-role-profile'

const CWD = path.join(process.cwd(), 'node_modules', '.cache', 'agent-launch-environment-test')
const TOKEN = 'secret-token-for-test'
const MARKER = '2080'
const EXPLICIT_TOKEN = 'caller-token-for-test'
const EXPLICIT_TMPDIR = '/caller/tmp'

const get = vi.spyOn(gh_cli_token, 'get')

afterEach(() => {
	rmSync(CWD, { force: true, recursive: true })
	vi.clearAllMocks()
})

describe('OpenAI detached launch environment', () => {
	it('passes the parent gh token only through the child environment', () => {
		get.mockReturnValue(TOKEN)

		const environment = agent_launch_environment.build(
			CWD,
			agent_role_profile.OPENAI_PROFILES.worker,
			{ JOSH_LANE_CHILD_ISSUE: MARKER },
		)

		expect(environment['GH_TOKEN']).toBe(TOKEN)
		expect(environment['JOSH_LANE_CHILD_ISSUE']).toBe(MARKER)
	})

	it('creates TMPDIR below the child work tree', () => {
		get.mockReturnValue(undefined)

		const environment = agent_launch_environment.build(
			CWD,
			agent_role_profile.OPENAI_PROFILES.scheduler,
		)

		expect(environment['TMPDIR']).toBe(path.join(CWD, 'node_modules', '.cache', 'josh', 'openai'))
		expect(existsSync(environment['TMPDIR'] ?? '')).toBe(true)
		expect(environment).not.toHaveProperty('GH_TOKEN')
	})

	it('keeps explicit caller auth and TMPDIR values', () => {
		get.mockReturnValue(TOKEN)

		const environment = agent_launch_environment.build(
			CWD,
			agent_role_profile.OPENAI_PROFILES.worker,
			{ GH_TOKEN: EXPLICIT_TOKEN, TMPDIR: EXPLICIT_TMPDIR },
		)

		expect(environment['GH_TOKEN']).toBe(EXPLICIT_TOKEN)
		expect(environment['TMPDIR']).toBe(EXPLICIT_TMPDIR)
	})
})

describe('Anthropic detached launch environment', () => {
	it('leaves explicit child environment unchanged and does not read gh auth', () => {
		const input = { JOSH_LANE_CHILD_ISSUE: MARKER }

		const environment = agent_launch_environment.build(
			CWD,
			agent_role_profile.DEFAULT_PROFILES.worker,
			input,
		)

		expect(environment).toBe(input)
		expect(get).not.toHaveBeenCalled()
		expect(existsSync(CWD)).toBe(false)
	})
})
