import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { implementation_authority } from './implementation-authority'

const RUNTIME_FILE = 'scripts/example.ts'

function payload(file_paths: Array<string>, tool_name = 'Edit'): string {
	return JSON.stringify({
		tool_name,
		tool_input: { file_paths },
		transcript_path: path.join(tmpdir(), 'session'),
	})
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('implementation authority', () => {
	it('refuses a mixed Codex patch even when its first path is documentation', () => {
		vi.stubEnv(agent_session_role.KEY, undefined)

		expect(implementation_authority.reason(payload(['README.md', RUNTIME_FILE]))).toBe(
			agent_session_role.scope_line(),
		)
	})

	it.each(['scheduler', 'reviewer', undefined])('allows operational records for %s', (role) => {
		vi.stubEnv(agent_session_role.KEY, role)

		for (const paths of [
			['README.md'],
			['prompts/plan.md'],
			[path.join(tmpdir(), 'review-findings.json')],
		]) {
			expect(implementation_authority.reason(payload(paths, 'Write'))).toBeUndefined()
		}

		expect(implementation_authority.reason(payload([], 'Bash'))).toBeUndefined()
	})

	it('allows a launcher-assigned worker to edit runtime files', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')

		expect(implementation_authority.reason(payload([RUNTIME_FILE]))).toBeUndefined()
	})
})
