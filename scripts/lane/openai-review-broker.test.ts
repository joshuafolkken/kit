import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { openai_review_broker } from './openai-review-broker'

const resolve_mock = vi.hoisted(() => vi.fn())
const argv_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const ISSUE = '2654'
const MISSING_RESPONSE = 'response path is missing'
const LANE = {
	issue: ISSUE,
	directory: '/registered/lane',
	branch: '2654-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
} satisfies LaneInfo

vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { resolve: resolve_mock },
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))

const state = { directory: '' }

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'review-broker-'))
	LANE.directory = path.join(state.directory, 'lane')
	resolve_mock.mockReturnValue(path.join(state.directory, '.git'))
	argv_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'codex', args: ['exec', '--sandbox', 'workspace-write'] },
		profile: { provider: 'openai', role: 'reviewer', model: 'gpt-6.1-sol', effort: 'high' },
	})
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
})

afterEach(() => {
	rmSync(state.directory, { recursive: true, force: true })
})

async function invalid_request(): Promise<void> {
	writeFileSync(openai_review_broker.request_path(LANE.directory, ISSUE), 'exec /bin/sh')
	await new Promise((resolve) => setTimeout(resolve, 250))
}

async function extra_field_request(field: string): Promise<void> {
	const target = openai_review_broker.response_path(LANE.directory, ISSUE)
	if (target === undefined) throw new Error(MISSING_RESPONSE)
	const response: unknown = JSON.parse(readFileSync(target, 'utf8'))
	if (typeof response !== 'object' || response === null || !('session' in response)) return
	const payload = { session: response.session, nonce: randomUUID(), round: '1', [field]: '/bin/sh' }

	writeFileSync(openai_review_broker.request_path(LANE.directory, ISSUE), JSON.stringify(payload))
	await new Promise((resolve) => setTimeout(resolve, 250))
}

it('derives the reviewer command and checkout from the registered lane', async () => {
	const result = await openai_review_broker.with_server(LANE, async () =>
		(await openai_review_broker.request(LANE.directory, ISSUE, '1')) ? 0 : 1,
	)

	expect(result).toBe(0)
	expect(argv_mock).toHaveBeenCalledWith(
		expect.stringContaining('review:attest'),
		'reviewer',
		LANE.directory,
	)
	expect(launch_mock.mock.calls[0]?.[0]).toMatchObject({ cwd: LANE.directory })
})

it('keeps the second review round read-only', async () => {
	const is_success = await openai_review_broker.with_server(
		LANE,
		async () => await openai_review_broker.request(LANE.directory, ISSUE, '2'),
	)

	expect(is_success).toBe(true)
	expect(argv_mock).toHaveBeenCalledWith(
		expect.stringContaining('Do not edit any file.'),
		'reviewer',
		LANE.directory,
	)
})

it('does not overwrite a symlink target when publishing a request', async () => {
	const victim = path.join(state.directory, 'victim.txt')
	const original = 'original content'

	writeFileSync(victim, original)
	const is_success = await openai_review_broker.with_server(LANE, async () => {
		symlinkSync(victim, openai_review_broker.request_path(LANE.directory, ISSUE))

		return await openai_review_broker.request(LANE.directory, ISSUE, '1')
	})

	expect(is_success).toBe(true)
	expect(readFileSync(victim, 'utf8')).toBe(original)
})

it('rejects arbitrary commands without starting a reviewer', async () => {
	await openai_review_broker.with_server(LANE, invalid_request)

	expect(launch_mock).not.toHaveBeenCalled()
})

it.each(['command', 'args', 'cwd', 'model', 'write_directory'])(
	'rejects a request carrying %s',
	async (field) => {
		await openai_review_broker.with_server(LANE, async () => {
			await extra_field_request(field)
		})
		expect(launch_mock).not.toHaveBeenCalled()
	},
)

it('fails closed when the isolated reviewer is unavailable', async () => {
	expect(await openai_review_broker.request(LANE.directory, ISSUE, '1')).toBe(false)
})

it('rejects a response after the trusted heartbeat expires', async () => {
	const target = openai_review_broker.response_path(LANE.directory, ISSUE)
	if (target === undefined) throw new Error(MISSING_RESPONSE)
	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(
		target,
		JSON.stringify({
			session: randomUUID(),
			nonce: '',
			is_success: false,
			heartbeat_at: Date.now() - 60_000,
		}),
	)

	expect(await openai_review_broker.request(LANE.directory, ISSUE, '1')).toBe(false)
	expect(launch_mock).not.toHaveBeenCalled()
})

it('refuses a non-OpenAI reviewer profile', async () => {
	argv_mock.mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: { provider: 'anthropic', role: 'reviewer', model: 'opus', effort: 'high' },
	})
	const is_result = await openai_review_broker.with_server(
		LANE,
		async () => await openai_review_broker.request(LANE.directory, ISSUE, '2'),
	)

	expect(is_result).toBe(false)
	expect(launch_mock).not.toHaveBeenCalled()
})
