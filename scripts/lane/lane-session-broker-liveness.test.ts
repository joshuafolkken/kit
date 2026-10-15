import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_broker_server } from './lane-broker-server'
import type { LaneInfo } from './lane-registry'
import { lane_session_broker } from './lane-session-broker'

// Whether a ship reads the server as live: the server record, the legacy heartbeat beside it, and a
// review the server is still running however long it writes nothing (joshuafolkken/kit#3840).

const resolve_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const ISSUE = '3840'
const ROUND_ONE = { kind: 'review', round: '1' } as const
const ANTHROPIC_PROFILE = {
	provider: 'anthropic',
	role: 'reviewer',
	model: 'opus',
	effort: 'high',
} as const
const LANE: LaneInfo = {
	issue: ISSUE,
	directory: '/registered/lane',
	branch: '3840-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: undefined,
}
// A minute of clock, far past the 3 s the heartbeat allowed, while the heartbeat timer never fires.
const SILENT_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ['Date', 'setInterval'] }
const SILENT_MS = 60_000
const EXPIRED_MS = 60_000
// Long enough for the waiting ship to poll the response several times inside the silence.
const POLL_WAIT_MS = 300

vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { resolve: resolve_mock },
}))
vi.mock('#scripts/agent/agent-argv', () => ({
	agent_argv: {
		resolve_in: () => ({
			kind: 'argv',
			argv: { command: 'claude', args: [] },
			profile: ANTHROPIC_PROFILE,
		}),
	},
}))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))

const state = { directory: '' }

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'review-broker-liveness-'))
	LANE.directory = path.join(state.directory, 'lane')
	resolve_mock.mockReturnValue(path.join(state.directory, '.git'))
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
})

afterEach(() => {
	vi.useRealTimers()
	rmSync(state.directory, { recursive: true, force: true })
})

function response_target(): string {
	const target = lane_session_broker.response_path(LANE.directory, ISSUE)
	if (target === undefined) throw new Error('response path is missing')

	return target
}

// A response a server left behind, with the record naming its process where `server` is given.
function leave_response(
	heartbeat_at: number,
	server?: { pid: number; process_start?: string },
): void {
	const target = response_target()
	const session = randomUUID()

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(target, JSON.stringify({ session, nonce: '', is_success: false, heartbeat_at }))
	if (server === undefined) return
	writeFileSync(lane_broker_server.server_path(target), JSON.stringify({ session, ...server }))
}

// A supervisor killed before it could remove its response leaves it behind.
describe('lane_session_broker — a response whose server is gone', () => {
	it('rejects it once its process is gone, however fresh its heartbeat', async () => {
		leave_response(Date.now(), { pid: process_identity_fixture.DEAD_PID })

		expect(await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)).toBe(false)
		expect(launch_mock).not.toHaveBeenCalled()
	})

	it.skipIf(!process_identity_fixture.has_native_start_probe)(
		'rejects it once its pid names a process started after it',
		() => {
			leave_response(Date.now(), {
				pid: process.pid,
				process_start: process_identity_fixture.FOREIGN_START,
			})

			expect(lane_session_broker.is_serving(LANE.directory, ISSUE)).toBe(false)
		},
	)
})

// A supervisor started before the server record is read by its heartbeat until it restarts.
describe('lane_session_broker — a response from a supervisor that predates the server record', () => {
	it('reads a fresh heartbeat as a serving server', () => {
		leave_response(Date.now())

		expect(lane_session_broker.is_serving(LANE.directory, ISSUE)).toBe(true)
	})

	it('rejects a response after its heartbeat expires', async () => {
		leave_response(Date.now() - EXPIRED_MS)

		expect(await lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)).toBe(false)
		expect(launch_mock).not.toHaveBeenCalled()
	})
})

// A ship branched before the server record parses the response strictly, so a new field reads as no
// server and sends a Claude lane back to the token-less reviewer of joshuafolkken/kit#3817.
function response_fields(): ReadonlyArray<string> {
	const response = JSON.parse(readFileSync(response_target(), 'utf8')) as object

	return Object.keys(response).toSorted((left, right) => left.localeCompare(right))
}

it('publishes a response in the shape a ship that predates the server record reads', async () => {
	const fields = await lane_session_broker.with_server(LANE, async () => response_fields())

	expect(fields).toStrictEqual(['heartbeat_at', 'is_success', 'nonce', 'session'])
})

async function stay_silent(): Promise<void> {
	vi.setSystemTime(Date.now() + SILENT_MS)
	await new Promise((resolve) => setTimeout(resolve, POLL_WAIT_MS))
}

function held_reviewer(): { finish: () => void } {
	const reviewer = { finish: (): void => undefined }

	launch_mock.mockImplementation(
		async () =>
			await new Promise((resolve) => {
				reviewer.finish = () => {
					resolve({ kind: 'completed', pid: 1, exit_code: 0 })
				}
			}),
	)

	return reviewer
}

async function review_started(): Promise<void> {
	await vi.waitFor(() => {
		expect(launch_mock).toHaveBeenCalledOnce()
	})
}

// The supervisor serving every Claude lane writes nothing while a synchronous call blocks it, and a
// ship waiting on its reviewer read that silence as a dead server.
describe('lane_session_broker — waiting on a review the server is still running', () => {
	it('answers the reviewer’s verdict however long the server writes nothing', async () => {
		const reviewer = held_reviewer()

		vi.useFakeTimers(SILENT_TIMERS)
		const is_success = await lane_session_broker.with_server(LANE, async () => {
			const pending = lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)

			await review_started()
			await stay_silent()
			reviewer.finish()

			return await pending
		})

		expect(is_success).toBe(true)
	})

	// joshuafolkken/kit#3817: a server told to stop while its reviewer still runs keeps its response
	// until the reviewer answers, so the waiting ship reads the verdict rather than a dead server.
	it('answers the review it was serving when it was told to stop', async () => {
		const reviewer = held_reviewer()
		const asked = { pending: Promise.resolve(false) }

		vi.useFakeTimers(SILENT_TIMERS)
		const stopping = lane_session_broker.with_server(LANE, async () => {
			asked.pending = lane_session_broker.request(LANE.directory, ISSUE, ROUND_ONE)
			await review_started()
		})

		await stay_silent()
		reviewer.finish()

		expect(await asked.pending).toBe(true)
		await stopping
	})
})

describe('lane_session_broker.is_serving', () => {
	it('answers true while a server holds the lane', async () => {
		const is_result = await lane_session_broker.with_server(LANE, async () =>
			lane_session_broker.is_serving(LANE.directory, ISSUE),
		)

		expect(is_result).toBe(true)
	})

	it('answers false once the server has stopped', async () => {
		await lane_session_broker.with_server(LANE, async () => undefined)

		expect(lane_session_broker.is_serving(LANE.directory, ISSUE)).toBe(false)
	})
})
