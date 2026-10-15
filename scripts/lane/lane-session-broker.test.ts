import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'
import { lane_session_broker } from './lane-session-broker'

const resolve_mock = vi.hoisted(() => vi.fn())
const argv_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const parked_mock = vi.hoisted(() => vi.fn())
const ISSUE = '2654'
const MISSING_RESPONSE = 'response path is missing'
const ROUND_ONE = { kind: 'review', round: '1' } as const
const ROUND_TWO = { kind: 'review', round: '2' } as const
const OPENAI_PROFILE = {
	provider: 'openai',
	role: 'reviewer',
	model: 'gpt-6.1-sol',
	effort: 'high',
} as const
const ANTHROPIC_PROFILE = {
	provider: 'anthropic',
	role: 'reviewer',
	model: 'opus',
	effort: 'high',
} as const
const RELAUNCH = {
	kind: 'relaunch',
	stop: { stage: 'gate', title: 'Fix the gate', flags: [], is_review: true },
} as const
const LANE: LaneInfo = {
	issue: ISSUE,
	directory: '/registered/lane',
	branch: '2654-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: OPENAI_PROFILE,
}
const CLAUDE_LANE: LaneInfo = { ...LANE, profile: undefined }
const REJECTED = { kind: 'rejected', note: 'no profile' } as const

vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { resolve: resolve_mock },
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { resolve_in: argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))
vi.mock('./lane-parked', () => ({ lane_parked: { is_parked: parked_mock } }))

const state = { directory: '' }

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'review-broker-'))
	LANE.directory = path.join(state.directory, 'lane')
	CLAUDE_LANE.directory = LANE.directory
	resolve_mock.mockReturnValue(path.join(state.directory, '.git'))
	argv_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'codex', args: ['exec', '--sandbox', 'workspace-write'] },
		profile: OPENAI_PROFILE,
	})
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
	parked_mock.mockReset().mockResolvedValue(false)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(state.directory, { recursive: true, force: true })
})

async function invalid_request(): Promise<void> {
	writeFileSync(lane_session_broker.request_path(LANE.directory, ISSUE), 'exec /bin/sh')
	await new Promise((resolve) => setTimeout(resolve, 250))
}

async function extra_field_request(field: string): Promise<void> {
	const target = lane_session_broker.response_path(LANE.directory, ISSUE)
	if (target === undefined) throw new Error(MISSING_RESPONSE)
	const response: unknown = JSON.parse(readFileSync(target, 'utf8'))
	if (typeof response !== 'object' || response === null || !('session' in response)) return
	const payload = {
		session: response.session,
		nonce: randomUUID(),
		action: { ...ROUND_ONE, [field]: '/bin/sh' },
	}

	writeFileSync(lane_session_broker.request_path(LANE.directory, ISSUE), JSON.stringify(payload))
	await new Promise((resolve) => setTimeout(resolve, 250))
}

async function request_relaunch(lane: LaneInfo): Promise<boolean> {
	return await lane_session_broker.with_server(
		lane,
		async () => await lane_session_broker.request(LANE.directory, ISSUE, RELAUNCH),
	)
}

function claude_reviewer(): void {
	argv_mock.mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: ANTHROPIC_PROFILE,
	})
}

it('derives the reviewer command and checkout from the registered lane', async () => {
	const result = await lane_session_broker.with_server(LANE, async () =>
		(await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)) ? 0 : 1,
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
	const is_success = await lane_session_broker.with_server(
		LANE,
		async () => await lane_session_broker.request(LANE.directory, ISSUE, ROUND_TWO),
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
	const is_success = await lane_session_broker.with_server(LANE, async () => {
		symlinkSync(victim, lane_session_broker.request_path(LANE.directory, ISSUE))

		return await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)
	})

	expect(is_success).toBe(true)
	expect(readFileSync(victim, 'utf8')).toBe(original)
})

it('rejects arbitrary commands without starting a reviewer', async () => {
	await lane_session_broker.with_server(LANE, invalid_request)

	expect(launch_mock).not.toHaveBeenCalled()
})

it.each(['command', 'args', 'cwd', 'model', 'write_directory'])(
	'rejects a request carrying %s',
	async (field) => {
		await lane_session_broker.with_server(LANE, async () => {
			await extra_field_request(field)
		})
		expect(launch_mock).not.toHaveBeenCalled()
	},
)

it('fails closed when the isolated reviewer is unavailable', async () => {
	expect(await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)).toBe(false)
})

it("refuses a reviewer on a provider other than the lane's own", async () => {
	claude_reviewer()
	const is_result = await lane_session_broker.with_server(
		LANE,
		async () => await lane_session_broker.request(LANE.directory, ISSUE, ROUND_TWO),
	)

	expect(is_result).toBe(false)
	expect(launch_mock).not.toHaveBeenCalled()
})

// joshuafolkken/kit#3817: a Claude lane's reviewer is started by the supervisor's broker, on Claude.
it('starts a Claude reviewer for a Claude lane', async () => {
	claude_reviewer()
	const is_result = await lane_session_broker.with_server(
		CLAUDE_LANE,
		async () => await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE),
	)

	expect(is_result).toBe(true)
	expect(launch_mock).toHaveBeenCalledOnce()
})

it("marks the reviewer as the lane's child rather than inheriting the server's environment", async () => {
	claude_reviewer()
	await lane_session_broker.with_server(
		CLAUDE_LANE,
		async () => await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE),
	)

	expect(launch_mock.mock.calls[0]?.[0]).toMatchObject({ env: { JOSH_LANE_CHILD: ISSUE } })
})

describe('lane_session_broker — the relaunch action', () => {
	it('relaunches a Claude lane child with the ship-stop invocation', async () => {
		const relaunch = vi
			.spyOn(lane_relaunch, 'relaunch')
			.mockReturnValue({ kind: 'launched', pid: 1 })

		expect(await request_relaunch(CLAUDE_LANE)).toBe(true)
		expect(relaunch).toHaveBeenCalledWith(
			CLAUDE_LANE,
			expect.stringContaining('detached ship supervisor stopped'),
			'implementation',
			expect.any(Function),
		)
		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('refuses to relaunch an OpenAI lane child', async () => {
		const relaunch = vi.spyOn(lane_relaunch, 'relaunch')

		expect(await request_relaunch(LANE)).toBe(false)
		expect(relaunch).not.toHaveBeenCalled()
	})

	it('answers a failure when the relaunch is rejected', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockReturnValue(REJECTED)

		expect(await request_relaunch(CLAUDE_LANE)).toBe(false)
	})
})

// joshuafolkken/kit#3878: a parked lane got a reviewer and then a relaunch from requests read late.
describe('lane_session_broker — a parked issue and a finished request', () => {
	it('ends the reviewer prompt with the review invocation the liveness pattern matches', async () => {
		await lane_session_broker.with_server(
			LANE,
			async () => await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE),
		)

		expect(argv_mock).toHaveBeenCalledWith(
			expect.stringMatching(/the reviewer of lane #2654$/u),
			'reviewer',
			LANE.directory,
		)
	})

	it('starts neither a reviewer nor a relaunch for a parked issue', async () => {
		parked_mock.mockResolvedValue(true)
		const relaunch = vi.spyOn(lane_relaunch, 'relaunch')
		const is_review = await lane_session_broker.with_server(
			LANE,
			async () => await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE),
		)

		expect(is_review).toBe(false)
		expect(await request_relaunch(CLAUDE_LANE)).toBe(false)
		expect(parked_mock).toHaveBeenCalledWith(ISSUE)
		expect(launch_mock).not.toHaveBeenCalled()
		expect(relaunch).not.toHaveBeenCalled()
	})

	it('withdraws its request once answered, so no server acts on it later', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockReturnValue(REJECTED)

		expect(await request_relaunch(CLAUDE_LANE)).toBe(false)
		expect(existsSync(lane_session_broker.request_path(LANE.directory, ISSUE))).toBe(false)
	})
})
