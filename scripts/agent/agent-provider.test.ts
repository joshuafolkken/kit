import { describe, expect, it } from 'vitest'
import { agent_provider } from './agent-provider'

const { HANDED_PROVIDER_KEY } = agent_provider
const ANTHROPIC_ENV = { CLAUDE_CODE_SESSION_ID: 'claude-session' }
const OPENAI_ENV = { CODEX_THREAD_ID: 'codex-thread' }

describe('resolve_provider', () => {
	it('reads the session this process runs in', () => {
		expect(agent_provider.resolve_provider(ANTHROPIC_ENV)).toStrictEqual({
			kind: 'provider',
			provider: 'anthropic',
		})
		expect(agent_provider.resolve_provider(OPENAI_ENV)).toStrictEqual({
			kind: 'provider',
			provider: 'openai',
		})
	})

	it('refuses two detected sessions', () => {
		expect(agent_provider.resolve_provider({ ...ANTHROPIC_ENV, ...OPENAI_ENV })).toMatchObject({
			kind: 'rejected',
		})
	})

	it('falls back to the handed mark, then to the default', () => {
		expect(agent_provider.resolve_provider({ [HANDED_PROVIDER_KEY]: 'openai' })).toMatchObject({
			provider: 'openai',
		})
		expect(agent_provider.resolve_provider({})).toMatchObject({ is_default: true })
		expect(agent_provider.default_notice({})).toContain(HANDED_PROVIDER_KEY)
	})

	it('refuses a handed mark naming no allowed provider', () => {
		expect(agent_provider.resolve_provider({ [HANDED_PROVIDER_KEY]: 'other' })).toMatchObject({
			kind: 'rejected',
		})
	})
})

describe('provider consequences', () => {
	it('keeps the completion callback everywhere but a Codex session', () => {
		expect(agent_provider.has_completion_callback(OPENAI_ENV)).toBe(false)
		expect(agent_provider.has_completion_callback(ANTHROPIC_ENV)).toBe(true)
	})

	it('hands the resolved provider to a detached child', () => {
		expect(agent_provider.handoff_environment(OPENAI_ENV)).toStrictEqual({
			[HANDED_PROVIDER_KEY]: 'openai',
		})
	})

	it('trims a blank value to undefined', () => {
		expect(agent_provider.trimmed('  ')).toBeUndefined()
		expect(agent_provider.trimmed(' x ')).toBe('x')
	})
})
