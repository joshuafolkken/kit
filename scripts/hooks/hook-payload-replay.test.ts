import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { json_value } from '#scripts/lib/json-value'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { codex_hook_adapter } from './codex-hook-adapter'
import { pretool_outcome } from './pretool-guard'

// Every payload captured from a real Claude Code or Codex run (`scripts/hooks/fixtures/`, captured with
// `JOSH_HOOK_CAPTURE_DIR` — `docs/environment-variables.md` → "Capturing hook payload fixtures") is
// replayed through the `pretool:guard` entry its provider reaches, once per role, so a guard or parser
// change that breaks one provider's real input fails here rather than in a review lane
// (joshuafolkken/kit#6588).

// The lane-plan guard reads the run's plan off disk; a replay has no run.
vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))

const FIXTURE_DIRECTORY = path.join(import.meta.dirname, 'fixtures')
const CODEX_PREFIX = 'codex-'
const WRITE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'apply_patch'])
// No transcript exists under it, so each fixture replays as a session's first call.
const REPLAY_HOME = temporary_directory('suite')('hook-payload-replay-')
const PLACEHOLDERS: ReadonlyArray<readonly [string, string]> = [
	['__ROOT__', process.cwd()],
	['__HOME__', REPLAY_HOME],
	['__PROJECT__', 'project'],
]

const tool_schema = z.looseObject({ tool_name: z.string() })

interface Fixture {
	name: string
	raw: string
	writes: boolean
}

interface Role {
	name: string
	value: string
	refuses_writes: boolean
}

const ROLES: ReadonlyArray<Role> = [
	{ name: 'consultation', value: 'scheduler', refuses_writes: true },
	{ name: 'lane', value: 'worker', refuses_writes: false },
]

function resolve_placeholders(text: string): string {
	let body = text

	for (const [token, value] of PLACEHOLDERS) body = body.replaceAll(token, () => value)

	return body
}

function load_fixture(file: string): Fixture {
	const raw = resolve_placeholders(readFileSync(path.join(FIXTURE_DIRECTORY, file), 'utf8'))
	const tool_name = json_value.parse_with(raw, tool_schema)?.tool_name ?? ''

	return { name: path.basename(file, '.json'), raw, writes: WRITE_TOOLS.has(tool_name) }
}

function replay(fixture: Fixture): GuardOutcome {
	return fixture.name.startsWith(CODEX_PREFIX)
		? codex_hook_adapter.pretool_outcome(fixture.raw)
		: pretool_outcome(fixture.raw)
}

const FIXTURES = readdirSync(FIXTURE_DIRECTORY).map((file) => load_fixture(file))

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('captured hook payload replay', () => {
	it('has a captured payload from each provider', () => {
		const providers = new Set(FIXTURES.map((fixture) => fixture.name.split('-', 1)[0]))

		expect(providers).toStrictEqual(new Set(['claude', 'codex']))
	})

	describe.each(FIXTURES)('$name', (fixture) => {
		it.each(ROLES)('is judged as the $name role judges it', (role) => {
			vi.stubEnv(agent_session_role.KEY, role.value)

			const { reason } = replay(fixture)

			expect(reason !== undefined, reason).toBe(fixture.writes && role.refuses_writes)
		})
	})
})
