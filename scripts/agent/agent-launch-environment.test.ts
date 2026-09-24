import { existsSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gh_cli_token } from '#scripts/gh/gh-cli-token'
import { PLATFORM_TEMP_ROOT, platform_temporary } from '#scripts/josh/platform-temporary'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent_launch_environment } from './agent-launch-environment'
import { agent_role_profile } from './agent-role-profile'

const CWD = path.join(process.cwd(), 'node_modules', '.cache', 'agent-launch-environment-test')
const SOURCE = path.join(process.cwd(), 'node_modules', '.cache', 'agent-launch-source-test')
const NEXT_SOURCE = `${SOURCE}-next`
const TOKEN = 'secret-token-for-test'
const MARKER = '2080'
const EXPLICIT_TOKEN = 'caller-token-for-test'
const EXPLICIT_TMPDIR = '/caller/tmp'
const AUTH_FILE = 'auth.json'
const CONFIG_FILE = 'config.toml'
const REVIEWER_HOME = ['node_modules', '.cache', 'josh', 'openai', 'reviewer-home']

const get = vi.spyOn(gh_cli_token, 'get')

afterEach(() => {
	rmSync(CWD, { force: true, recursive: true })
	rmSync(SOURCE, { force: true, recursive: true })
	rmSync(NEXT_SOURCE, { force: true, recursive: true })
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

	it('creates TMPDIR under the platform temporary root and outside the child work tree', () => {
		get.mockReturnValue(undefined)

		const environment = agent_launch_environment.build(
			CWD,
			agent_role_profile.OPENAI_PROFILES.scheduler,
		)

		expect(environment['TMPDIR']).toBe(PLATFORM_TEMP_ROOT)
		expect(path.relative(CWD, environment['TMPDIR'] ?? '')).toMatch(/^\.\./u)
		expect(existsSync(environment['TMPDIR'] ?? '')).toBe(true)
		expect(platform_temporary.is_writable_directory(environment['TMPDIR'] ?? '')).toBe(true)
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

describe('OpenAI reviewer state', () => {
	it('keeps mutable state in the lane and links the existing auth and config', () => {
		mkdirSync(SOURCE, { recursive: true })
		writeFileSync(path.join(SOURCE, AUTH_FILE), 'test-auth')
		writeFileSync(path.join(SOURCE, CONFIG_FILE), 'test-config')
		const environment = agent_launch_environment.build(
			CWD,
			agent_role_profile.OPENAI_PROFILES.reviewer,
			{ CODEX_HOME: SOURCE },
		)
		const home = environment['CODEX_HOME'] ?? ''

		expect(home).toBe(path.join(CWD, ...REVIEWER_HOME))
		expect(readlinkSync(path.join(home, AUTH_FILE))).toBe(path.join(SOURCE, AUTH_FILE))
		expect(readlinkSync(path.join(home, CONFIG_FILE))).toBe(path.join(SOURCE, CONFIG_FILE))
		expect(existsSync(path.join(home, 'installation_id'))).toBe(false)
	})
})

describe('OpenAI reviewer home switch', () => {
	it('updates auth and config links when the source home changes', () => {
		mkdirSync(SOURCE, { recursive: true })
		mkdirSync(NEXT_SOURCE, { recursive: true })

		for (const name of [AUTH_FILE, CONFIG_FILE]) {
			writeFileSync(path.join(SOURCE, name), 'first')
			writeFileSync(path.join(NEXT_SOURCE, name), 'second')
		}

		agent_launch_environment.build(CWD, agent_role_profile.OPENAI_PROFILES.reviewer, {
			CODEX_HOME: SOURCE,
		})
		const next = agent_launch_environment.build(CWD, agent_role_profile.OPENAI_PROFILES.reviewer, {
			CODEX_HOME: NEXT_SOURCE,
		})
		const home = next['CODEX_HOME'] ?? ''

		expect(readlinkSync(path.join(home, AUTH_FILE))).toBe(path.join(NEXT_SOURCE, AUTH_FILE))
		expect(readlinkSync(path.join(home, CONFIG_FILE))).toBe(path.join(NEXT_SOURCE, CONFIG_FILE))
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
