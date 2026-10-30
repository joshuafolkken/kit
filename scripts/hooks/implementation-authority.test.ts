import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { implementation_authority } from './implementation-authority'

const RUNTIME_FILE = 'scripts/example.ts'
const UNKNOWN_INPUT = 'Cannot verify'
const REFUSED = 'Implementation refused before execution'

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

		expect(implementation_authority.reason(payload(['README.md', RUNTIME_FILE]))).toContain(REFUSED)
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
	})

	it('allows a launcher-assigned worker to edit runtime files', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')

		expect(implementation_authority.reason(payload([RUNTIME_FILE]))).toBeUndefined()
	})

	it('refuses source edits outside the checkout through the same authority check', () => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')
		const file_path = path.join(tmpdir(), 'other-repo/app.ts')
		const raw_payload = payload([file_path])

		expect(implementation_authority.reason(raw_payload)).toContain(REFUSED)
	})

	it.each(['Edit', 'Write', 'Bash', 'apply_patch', 'exec'])(
		'refuses an unverified %s input without granting implementation authority',
		(tool_name) => {
			vi.stubEnv(agent_session_role.KEY, undefined)

			expect(implementation_authority.reason(payload([], tool_name))).toContain(UNKNOWN_INPUT)
		},
	)
})

function shell_payload(command: string): string {
	return JSON.stringify({
		tool_name: 'Bash',
		tool_input: { command },
		transcript_path: path.join(tmpdir(), 'session'),
	})
}

describe('shell implementation authority', () => {
	it.each([
		'printf changed > scripts/example.ts',
		'printf changed>scripts/example.ts',
		'echo changed | tee scripts/example.ts',
		'sed -i s/old/new/ scripts/example.ts',
		"node -e \"require('fs').writeFileSync('scripts/example.ts', 'changed')\"",
		"python3 -c \"open('scripts/example.ts', 'w').write('changed')\"",
		'cp /tmp/replacement scripts/example.ts',
		'bash -c "echo changed > scripts/example.ts"',
		'printf changed > "$TARGET"',
		'custom-editor scripts/example.ts',
	])('refuses an implementation or unverifiable shell path: %s', (command) => {
		vi.stubEnv(agent_session_role.KEY, 'scheduler')

		const first = implementation_authority.reason(shell_payload(command))

		expect(first).toContain('lane:dispatch')
		expect(implementation_authority.reason(shell_payload(command))).toBe(first)
	})
})

describe('operational shell authority', () => {
	it.each([
		'rg implementation scripts',
		'cat scripts/example.ts',
		'printf plan > prompts/plan.md',
		'printf plan | tee /tmp/issue-body.md',
		'pnpm josh issue:comment 5454 --body-file /tmp/issue-body.md',
		'pnpm josh lane:dispatch 5454',
		'gh api repos/owner/repo/issues/5454',
	])('keeps reads and operational records available: %s', (command) => {
		vi.stubEnv(agent_session_role.KEY, undefined)

		expect(implementation_authority.reason(shell_payload(command))).toBeUndefined()
	})

	it('allows worker shell writes and refuses unknown patch inputs for every other role', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')
		expect(implementation_authority.reason(shell_payload('echo changed > app.ts'))).toBeUndefined()

		for (const role of ['scheduler', 'reviewer', 'unknown', undefined]) {
			vi.stubEnv(agent_session_role.KEY, role)
			expect(implementation_authority.reason(payload([], 'apply_patch'))).toContain(UNKNOWN_INPUT)
		}
	})
})
