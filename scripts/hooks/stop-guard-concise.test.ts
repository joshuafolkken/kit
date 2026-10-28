import { agent_headless } from '#scripts/agent/agent-headless'
import { session_language } from '#scripts/josh/session-language'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { write_stop_decision } from './stop-guard'
import { stop_guard_fixture } from './stop-guard-fixture'

const { decide_in } = stop_guard_fixture

const TIMESTAMP = '2026-10-01T00:00:00.000Z'
const LONG_REPLY = 'The gate passed and the pull request is open. '.repeat(20)

// A `user` line as Claude Code writes it; `fields` adds the harness markers (`isMeta`).
function prompt_line(text: string, fields: Record<string, unknown> = {}): string {
	const line = {
		type: 'user',
		timestamp: TIMESTAMP,
		...fields,
		message: { role: 'user', content: text },
	}

	return JSON.stringify(line)
}

const SKILL_BODY = prompt_line('the expanded skill body', { isMeta: true })

// joshuafolkken/kit#5328: the person's prompt on the tail reaches the length rule, so asking for
// detail exempts — past a skill body the harness wrote after it.
describe('write_stop_decision — the concise-reply prompt is wired', () => {
	beforeEach(() => {
		// The suite may itself run inside a kit-launched agent, whose mark would stand the rule aside.
		vi.stubEnv(agent_headless.KEY, undefined)
	})

	afterEach(() => {
		Reflect.deleteProperty(process.env, session_language.ENV_KEY)
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('sends back a long reply the prompt did not ask detail for', async () => {
		const written = await decide_in(write_stop_decision, 'en', LONG_REPLY, prompt_line('status?'))

		expect(written.join('')).toContain('⛔ concise reply')
	})

	it('lets a long reply stop when a slash command asked for the detail', async () => {
		const tail = [prompt_line('/kickoff 詳しく'), SKILL_BODY].join('\n')

		expect(await decide_in(write_stop_decision, 'en', LONG_REPLY, tail)).toEqual([])
	})

	it('lets a long reply stop when no prompt of the person’s is on the tail', async () => {
		expect(await decide_in(write_stop_decision, 'en', LONG_REPLY, SKILL_BODY)).toEqual([])
	})
})
