import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

const { arrange, CARRY } = run_board_read_fixture

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('run_board_read scheduler', () => {
	it.each([
		{ provider: 'openai', expected: 'codex' },
		{ provider: 'anthropic', expected: 'claude' },
	] as const)(
		'reads scheduler $provider from the parent record',
		async ({ provider, expected }) => {
			vi.stubEnv('JOSH_AGENT_PROVIDER', provider === 'openai' ? 'anthropic' : 'openai')
			arrange({ kind: 'carried', carry: { ...CARRY, scheduler_provider: provider } }, undefined)
			const local = await run_board_read.read_local()

			expect(local?.scheduler_provider).toBe(expected)
		},
	)
})
