import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_event } from '#scripts/agent/agent-event'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detached_launch } from './detached-launch'

const POLL_LIMIT = 60
const POLL_INTERVAL_MS = 50
const OPENAI_PROVIDER = 'openai'
const THREAD_STARTED = 'thread.started'
const BUDGET_EXCEEDED = 'budget exceeded'
const PLAIN_STDERR = 'codex exited seven'
const LOG_NAME = 'codex.jsonl'
const GH_TOKEN = 'secret-detached-token'
const ENV_NAME = 'codex-environment'
const scratch = { directory: '', log: '' }

afterEach(() => {
	if (scratch.directory !== '') rmSync(scratch.directory, { force: true, recursive: true })
	scratch.directory = ''
	vi.unstubAllEnvs()
})

function fake_codex_script(events: ReadonlyArray<unknown>): string {
	return events.map((event) => `console.log(${JSON.stringify(JSON.stringify(event))})`).join(';')
}

async function log_text(marker = 'turn.'): Promise<string> {
	for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
		const text = readFileSync(scratch.log, 'utf8')
		if (text.includes(marker)) return text
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
	}

	return readFileSync(scratch.log, 'utf8')
}

function executable(name: string, source: string): string {
	const executable_path = path.join(scratch.directory, name)

	writeFileSync(executable_path, source)
	chmodSync(executable_path, 0o700)

	return executable_path
}

function write_provider_fakes(): void {
	const codex = String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_CALLS"
if [ "$1" = "login" ]; then exit 0; fi
printf '%s\n%s\n' "$GH_TOKEN" "$TMPDIR" > "$FAKE_ENV"
printf '%s\n' '{"type":"thread.started","thread_id":"fake"}'
printf '%s\n' '{"type":"error","message":"${BUDGET_EXCEEDED}"}'
printf '%s\n' '${PLAIN_STDERR}' >&2
exit 7
`
	const claude = String.raw`#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_CLAUDE_CALLS"
exit 99
`
	const gh = String.raw`#!/bin/sh
if [ "$1 $2" = "auth token" ]; then printf '%s\n' '${GH_TOKEN}'; exit 0; fi
exit 1
`

	executable('codex', codex)
	executable('claude', claude)
	executable('gh', gh)
}

function initialize_fake_outputs(calls: string, claude_calls: string): void {
	writeFileSync(calls, '')
	writeFileSync(claude_calls, '')
}

function arrange_provider_fakes(): { calls: string; claude_calls: string; environment: string } {
	const calls = path.join(scratch.directory, 'codex-calls')
	const claude_calls = path.join(scratch.directory, 'claude-calls')
	const environment = path.join(scratch.directory, ENV_NAME)

	write_provider_fakes()
	initialize_fake_outputs(calls, claude_calls)
	vi.stubEnv('PATH', scratch.directory)
	vi.stubEnv('FAKE_CALLS', calls)
	vi.stubEnv('FAKE_CLAUDE_CALLS', claude_calls)
	vi.stubEnv('FAKE_ENV', environment)

	return { calls, claude_calls, environment }
}

async function run_provider_failure(): Promise<{
	calls: string
	claude_calls: string
	environment: string
	launch_kind: string
	output: string
}> {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'fake-codex-provider-'))
	scratch.log = path.join(scratch.directory, LOG_NAME)
	const fake = arrange_provider_fakes()
	const built = agent_argv.resolve('fullrun #2071', agent_role_profile.WORKER, {
		JOSH_AGENT_PROVIDER: OPENAI_PROVIDER,
	})
	if (built.kind !== 'argv') throw new Error(built.note)
	const launch = detached_launch.launch(
		{ argv: built.argv, cwd: scratch.directory, log_path: scratch.log, profile: built.profile },
		() => undefined,
	)
	const output = await log_text(PLAIN_STDERR)

	return { ...fake, launch_kind: launch.kind, output }
}

async function run_fake(events: ReadonlyArray<unknown>): Promise<string> {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'fake-codex-'))
	scratch.log = path.join(scratch.directory, LOG_NAME)
	detached_launch.launch(
		{
			argv: { command: process.execPath, args: ['-e', fake_codex_script(events)] },
			cwd: scratch.directory,
			log_path: scratch.log,
		},
		() => undefined,
	)

	return await log_text()
}

describe('detached fake Codex success', () => {
	it('normalizes success from the output path used by lane and wake progress', async () => {
		const output = await run_fake([
			{ type: THREAD_STARTED, thread_id: 'fake' },
			{ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } },
		])

		expect(agent_event.read(output)).toMatchObject({
			provider: OPENAI_PROVIDER,
			launch: 'started',
			result: 'completed',
			usage: { input_tokens: 2, output_tokens: 1 },
		})
	})
})

describe('detached fake Codex failure through the provider adapter', () => {
	it('runs diagnostics then one nonzero process without a Claude fallback', async () => {
		const { calls, claude_calls, launch_kind, output } = await run_provider_failure()

		expect(launch_kind).toBe('launched')
		expect(agent_event.read(output)).toMatchObject({
			provider: OPENAI_PROVIDER,
			result: 'failed',
			reason: BUDGET_EXCEEDED,
		})
		expect(output).toContain(PLAIN_STDERR)
		const invocations = readFileSync(calls, 'utf8').trim().split('\n')

		expect(invocations.filter((line) => line === 'login status')).toHaveLength(1)
		expect(invocations.filter((line) => line.startsWith('exec '))).toHaveLength(1)
		expect(readFileSync(claude_calls, 'utf8')).toBe('')
	})

	it('passes auth and a work-tree TMPDIR without exposing the token in argv or logs', async () => {
		const { calls, environment, output } = await run_provider_failure()
		const [token, temporary_directory] = readFileSync(environment, 'utf8').trim().split('\n', 2)

		expect(token).toBe(GH_TOKEN)
		expect(temporary_directory).toBe(
			path.join(scratch.directory, 'node_modules', '.cache', 'josh', OPENAI_PROVIDER),
		)
		expect(readFileSync(calls, 'utf8')).not.toContain(GH_TOKEN)
		expect(output).not.toContain(GH_TOKEN)
	})
})
