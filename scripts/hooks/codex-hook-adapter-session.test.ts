import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codex_hook_adapter } from './codex-hook-adapter'

// joshuafolkken/kit#7607: a lane supervisor started from a Codex parent handed the parent's
// `CODEX_THREAD_ID` to every child, and each child's hook priced that thread — 117,240 against the
// 92,609 cut threshold — so every resumed generation was refused on its first edit.
const PARENT_THREAD = '01a1d054-5ddb-7861-ab42-ed7279404dd3'
const OWN_THREAD = '01a1d1da-dfcb-7d10-9b80-6f05cd788f64'
const PARENT_NEWEST_INPUT = 117_240
const RESUMED_NEWEST_INPUT = 35_115
const OVER_NEWEST_INPUT = 120_000
const FIRST_INPUT = 21_727
const make_directory = temporary_directory()

function token_count(last_input_tokens: number): string {
	return JSON.stringify({
		type: 'event_msg',
		payload: {
			type: 'token_count',
			info: {
				total_token_usage: { input_tokens: last_input_tokens },
				last_token_usage: { input_tokens: last_input_tokens },
			},
		},
	})
}

function write_rollout(codex_home: string, cwd: string, thread_id: string, newest: number): void {
	const directory = path.join(codex_home, 'sessions/2026/11/12')

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `rollout-${thread_id}.jsonl`),
		[
			JSON.stringify({ type: 'session_meta', payload: { id: thread_id, cwd } }),
			token_count(FIRST_INPUT),
			token_count(newest),
		].join('\n'),
	)
}

function edit_payload(session_id?: string): string {
	return JSON.stringify({
		...(session_id !== undefined && { session_id }),
		tool_name: 'apply_patch',
		tool_input: { command: '*** Begin Patch\n*** Update File: a.ts\n*** End Patch' },
	})
}

// The hook's own verdict, priced on the environment the adapter hands the guards.
function hook_verdict(project: string, raw_payload: string): string {
	return cost_cli.session_verdict(project, codex_hook_adapter.session_context(raw_payload).env)
}

interface SessionFixture {
	project: string
	codex_home: string
}

// A Codex home holding the over parent's rollout, inherited through CODEX_THREAD_ID.
function setup(): SessionFixture {
	const project = make_directory('codex-hook-session-project-')
	const codex_home = make_directory('codex-hook-session-home-')

	for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, undefined)
	vi.stubEnv('CODEX_THREAD_ID', PARENT_THREAD)
	vi.stubEnv('CODEX_HOME', codex_home)
	write_rollout(codex_home, project, PARENT_THREAD, PARENT_NEWEST_INPUT)

	return { project, codex_home }
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('codex_hook_adapter.session_context — the hook prices its own thread', () => {
	it("names the payload's session over an inherited CODEX_THREAD_ID", () => {
		setup()
		const context = codex_hook_adapter.session_context(edit_payload(OWN_THREAD))

		expect(context.env['CODEX_THREAD_ID']).toBe(OWN_THREAD)
	})

	it('keeps the inherited environment when the payload names no session', () => {
		setup()
		const context = codex_hook_adapter.session_context(edit_payload())

		expect(context.env['CODEX_THREAD_ID']).toBe(PARENT_THREAD)
	})

	it('reads a just-resumed generation under the cut threshold despite an over parent', () => {
		const { project, codex_home } = setup()

		write_rollout(codex_home, project, OWN_THREAD, RESUMED_NEWEST_INPUT)

		expect(hook_verdict(project, edit_payload(OWN_THREAD))).toBe('under')
	})

	it('still reads a generation whose own context crossed the threshold as over', () => {
		const { project, codex_home } = setup()

		write_rollout(codex_home, project, OWN_THREAD, OVER_NEWEST_INPUT)

		expect(hook_verdict(project, edit_payload(OWN_THREAD))).toBe('over')
	})
})
