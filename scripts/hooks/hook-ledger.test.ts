import { readFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { git_spawn } from '#scripts/git/git-spawn'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { hook_ledger } from './hook-ledger'

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const make_directory = temporary_directory('suite')
const scratch = make_directory('hook-ledger-test-')
const HOOK = 'pretool-guard'
const TRANSCRIPT = '/sessions/a.jsonl'
const COMMAND = 'pnpm josh gate'
const CONTEXT_ROLE = 'context-role'
const BATCHING_REASON = '⛔ batching: 3 single-call turns in a row. Reissue this.'
const BASH_PAYLOAD = JSON.stringify({
	tool_name: 'Bash',
	tool_input: { command: COMMAND },
	transcript_path: TRANSCRIPT,
})

function lines_in(directory: string): Array<string> {
	const day = new Date().toISOString().slice(0, 10)

	return readFileSync(path.join(directory, `${day}.jsonl`), 'utf8')
		.trimEnd()
		.split('\n')
}

describe('hook_ledger.record', () => {
	it('appends one line per refusal, naming the hook, rule, tool, Issue and command', async () => {
		vi.mocked(git_spawn.read).mockResolvedValue('6587-lane')
		const directory = path.join(scratch, 'one')

		await hook_ledger.record(
			{ hook: HOOK, reason: BATCHING_REASON, raw_payload: BASH_PAYLOAD },
			directory,
		)
		const lines = lines_in(directory)

		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0] ?? '')).toMatchObject({
			hook: HOOK,
			rule: 'batching',
			tool: 'Bash',
			issue: 6587,
			session: TRANSCRIPT,
			command: COMMAND,
		})
	})

	it('records a Stop refusal under the Stop tool, with no Issue off a branch naming none', async () => {
		vi.mocked(git_spawn.read).mockResolvedValue('main')
		const directory = path.join(scratch, 'stop')

		await hook_ledger.record({ hook: 'stop-guard', reason: 'held', raw_payload: '{}' }, directory)

		const entry: unknown = JSON.parse(lines_in(directory)[0] ?? '')

		expect(entry).toMatchObject({ tool: 'Stop', rule: 'held', command: '' })
		expect(entry).not.toHaveProperty('issue')
	})

	it('writes nothing under a test run, so a hook suite never reaches the real ledger', async () => {
		expect(hook_ledger.ledger_directory()).toBeUndefined()

		await expect(
			hook_ledger.record_reason(HOOK, BATCHING_REASON, BASH_PAYLOAD),
		).resolves.toBeUndefined()
	})
})

describe('hook_ledger.record call context', () => {
	it('records the role from the call context environment', async () => {
		vi.mocked(git_spawn.read).mockResolvedValue('6973-lane')
		const directory = path.join(scratch, 'role')

		await hook_ledger.record(
			{ hook: HOOK, reason: BATCHING_REASON, raw_payload: BASH_PAYLOAD },
			directory,
			{ cwd: scratch, env: { [agent_session_role.KEY]: CONTEXT_ROLE } },
		)

		expect(JSON.parse(lines_in(directory)[0] ?? '')).toMatchObject({ role: CONTEXT_ROLE })
	})
})

describe('hook_ledger.record payload fields', () => {
	it('keeps the tool and command of a payload whose transcript is null', async () => {
		vi.mocked(git_spawn.read).mockResolvedValue('6587-lane')
		const directory = path.join(scratch, 'null-transcript')
		const raw_payload = `{"tool_name":"Bash","tool_input":{"command":"${COMMAND}"},"transcript_path":null}`

		await hook_ledger.record({ hook: HOOK, reason: BATCHING_REASON, raw_payload }, directory)

		expect(JSON.parse(lines_in(directory)[0] ?? '')).toMatchObject({
			tool: 'Bash',
			session: '',
			command: COMMAND,
		})
	})
})

describe('hook_ledger.blocked_reason', () => {
	it('reads the reason a Stop envelope blocks with, and nothing from a notice alone', () => {
		const block = JSON.stringify({ decision: 'block', reason: BATCHING_REASON, systemMessage: 'x' })

		expect(hook_ledger.blocked_reason(block)).toBe(BATCHING_REASON)
		expect(hook_ledger.blocked_reason(JSON.stringify({ systemMessage: 'x' }))).toBeUndefined()
	})
})

describe('hook_ledger.rule_of', () => {
	it('names a rule by its opening, or the reason head where it has none', () => {
		expect(hook_ledger.rule_of('⛔ pre-gate cut: run it first')).toBe('pre-gate cut')
		expect(hook_ledger.rule_of('turn back')).toBe('turn back')
	})
})

describe('hook_ledger.command_of', () => {
	it('reads the shell line, then the file, capped at 80 characters', () => {
		expect(hook_ledger.command_of({ file_path: '/a.ts' })).toBe('/a.ts')
		expect(hook_ledger.command_of({ command: 'x'.repeat(100) })).toHaveLength(80)
		expect(hook_ledger.command_of(undefined)).toBe('')
	})
})
