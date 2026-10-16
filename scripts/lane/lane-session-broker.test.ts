import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'
import { lane_session_broker, type BrokerAction, type BrokerAnswer } from './lane-session-broker'

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
const SUCCESS = { is_success: true }

vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { resolve: resolve_mock },
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { review_in: argv_mock } }))
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

async function request_relaunch(lane: LaneInfo): Promise<BrokerAnswer> {
	return await lane_session_broker.with_server(
		lane,
		async () => await lane_session_broker.request(LANE.directory, ISSUE, RELAUNCH),
	)
}

async function request_review(lane: LaneInfo, round: BrokerAction): Promise<BrokerAnswer> {
	return await lane_session_broker.with_server(
		lane,
		async () => await lane_session_broker.request(LANE.directory, ISSUE, round),
	)
}

function reason_of(answer: BrokerAnswer): string {
	return answer.is_success ? '' : answer.reason
}

function claude_reviewer(): void {
	argv_mock.mockReturnValue({
		kind: 'argv',
		argv: { command: 'claude', args: [] },
		profile: ANTHROPIC_PROFILE,
	})
}

it('derives the reviewer command and checkout from the registered lane', async () => {
	expect(await request_review(LANE, ROUND_ONE)).toStrictEqual(SUCCESS)
	expect(argv_mock).toHaveBeenCalledWith(
		expect.stringContaining('review:attest'),
		Number(ROUND_ONE.round),
		LANE.directory,
	)
	expect(launch_mock.mock.calls[0]?.[0]).toMatchObject({ cwd: LANE.directory })
})

it('keeps the second review round read-only', async () => {
	expect(await request_review(LANE, ROUND_TWO)).toStrictEqual(SUCCESS)
	expect(argv_mock).toHaveBeenCalledWith(
		expect.stringContaining('Do not edit any file.'),
		Number(ROUND_TWO.round),
		LANE.directory,
	)
})

it('does not overwrite a symlink target when publishing a request', async () => {
	const victim = path.join(state.directory, 'victim.txt')
	const original = 'original content'

	writeFileSync(victim, original)
	const answer = await lane_session_broker.with_server(LANE, async () => {
		symlinkSync(victim, lane_session_broker.request_path(LANE.directory, ISSUE))

		return await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)
	})

	expect(answer).toStrictEqual(SUCCESS)
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
	expect(await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)).toStrictEqual({
		is_success: false,
		reason: 'no broker serves this lane',
	})
})

it("refuses a reviewer on a provider other than the lane's own", async () => {
	claude_reviewer()

	expect(await request_review(LANE, ROUND_TWO)).toMatchObject({ is_success: false })
	expect(launch_mock).not.toHaveBeenCalled()
})

// joshuafolkken/kit#3817: a Claude lane's reviewer is started by the supervisor's broker, on Claude.
it('starts a Claude reviewer for a Claude lane', async () => {
	claude_reviewer()

	expect(await request_review(CLAUDE_LANE, ROUND_ONE)).toStrictEqual(SUCCESS)
	expect(launch_mock).toHaveBeenCalledOnce()
})

it("marks the reviewer as the lane's child rather than inheriting the server's environment", async () => {
	claude_reviewer()
	await request_review(CLAUDE_LANE, ROUND_ONE)

	expect(launch_mock.mock.calls[0]?.[0]).toMatchObject({ env: { JOSH_LANE_CHILD: ISSUE } })
})

describe('lane_session_broker — the relaunch action', () => {
	it('relaunches a Claude lane child with the ship-stop invocation', async () => {
		const relaunch = vi
			.spyOn(lane_relaunch, 'relaunch')
			.mockReturnValue({ kind: 'launched', pid: 1 })

		expect(await request_relaunch(CLAUDE_LANE)).toStrictEqual(SUCCESS)
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

		expect(await request_relaunch(LANE)).toMatchObject({ is_success: false })
		expect(relaunch).not.toHaveBeenCalled()
	})

	it('answers a failure when the relaunch is rejected', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockReturnValue(REJECTED)

		expect(await request_relaunch(CLAUDE_LANE)).toMatchObject({ is_success: false })
	})
})

// joshuafolkken/kit#3974: a refused relaunch reached the ship log as a bare failure, so a stale
// supervisor refusing a multi-line prompt could not be told from a dead broker.
describe('lane_session_broker — a failed action names its reason', () => {
	it('names the rejected relaunch', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockReturnValue(REJECTED)

		expect(await request_relaunch(CLAUDE_LANE)).toStrictEqual({
			is_success: false,
			reason: 'the broker answered a failure: the relaunch did not start: no profile',
		})
	})

	it('answers an action that threw as a failure rather than a dead server', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockImplementation(() => {
			throw new Error('spawn EACCES')
		})

		expect(reason_of(await request_relaunch(CLAUDE_LANE))).toContain(
			'the broker answered a failure: the broker failed',
		)
	})
})

describe('lane_session_broker — the relaunch carries the stop context', () => {
	// joshuafolkken/kit#3923: the stop's context crosses the request file and reaches the prompt.
	it('carries the stop context through to the relaunched prompt', async () => {
		const relaunch = vi
			.spyOn(lane_relaunch, 'relaunch')
			.mockReturnValue({ kind: 'launched', pid: 1 })
		const excerpt = ['FAIL gate', 'expected 1 to be 2']
		const context = { excerpt, changed: ['scripts/a.ts'], more_changed: 0 }
		const action = { kind: 'relaunch', stop: { ...RELAUNCH.stop, context } } as const

		expect(await request_review(CLAUDE_LANE, action)).toStrictEqual(SUCCESS)
		expect(relaunch).toHaveBeenCalledWith(
			CLAUDE_LANE,
			expect.stringContaining('\nFAIL gate\nexpected 1 to be 2\n'),
			'implementation',
			expect.any(Function),
		)
	})
})

// joshuafolkken/kit#3878: a parked lane got a reviewer and then a relaunch from requests read late.
describe('lane_session_broker — a parked issue and a finished request', () => {
	it('ends the reviewer prompt with the review invocation the liveness pattern matches', async () => {
		await request_review(LANE, ROUND_ONE)

		expect(argv_mock).toHaveBeenCalledWith(
			expect.stringMatching(/the reviewer of lane #2654$/u),
			Number(ROUND_ONE.round),
			LANE.directory,
		)
	})

	it('starts neither a reviewer nor a relaunch for a parked issue', async () => {
		parked_mock.mockResolvedValue(true)
		const relaunch = vi.spyOn(lane_relaunch, 'relaunch')

		expect(await request_review(LANE, ROUND_ONE)).toMatchObject({ is_success: false })
		expect(await request_relaunch(CLAUDE_LANE)).toMatchObject({ is_success: false })
		expect(parked_mock).toHaveBeenCalledWith(ISSUE)
		expect(launch_mock).not.toHaveBeenCalled()
		expect(relaunch).not.toHaveBeenCalled()
	})

	it('withdraws its request once answered, so no server acts on it later', async () => {
		vi.spyOn(lane_relaunch, 'relaunch').mockReturnValue(REJECTED)

		expect(await request_relaunch(CLAUDE_LANE)).toMatchObject({ is_success: false })
		expect(existsSync(lane_session_broker.request_path(LANE.directory, ISSUE))).toBe(false)
	})
})
