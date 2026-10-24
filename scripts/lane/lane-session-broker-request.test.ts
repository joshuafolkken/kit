import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { review_attest } from '#scripts/review/review-attest'
import { run_ship_brokered_review } from '#scripts/run/ship/run-ship-brokered-review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_session_broker, type BrokerAction } from './lane-session-broker'

// joshuafolkken/kit#4714: the request ship sends, read by the broker's own schema, and the refusal that
// marks the supervisor's code for a re-check.

const resolve_mock = vi.hoisted(() => vi.fn())
const argv_mock = vi.hoisted(() => vi.fn())
const launch_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const reread_mock = vi.hoisted(() => vi.fn())
const ISSUE = '4714'
const SUCCESS = { is_success: true }
const NEWER = {
	kind: 'review',
	round: '1',
	is_from_newer_main: true,
} as unknown as BrokerAction
const REVIEWER_PROFILE = {
	provider: 'openai',
	role: 'reviewer',
	model: 'gpt-6.1-sol',
	effort: 'high',
} as const
const LANE: LaneInfo = {
	issue: ISSUE,
	directory: '/registered/lane',
	branch: '4714-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: REVIEWER_PROFILE,
}

vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { resolve: resolve_mock },
}))
vi.mock('#scripts/agent/agent-argv', () => ({ agent_argv: { review_in: argv_mock } }))
vi.mock('#scripts/run/detached-launch', () => ({
	detached_launch: { launch_attached: launch_mock },
}))
vi.mock('./lane-parked', () => ({ lane_parked: { is_parked: async () => false } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))
vi.mock('./lane-session-reread', () => ({ lane_session_reread: { reread: reread_mock } }))

const state = { directory: '' }

beforeEach(() => {
	state.directory = mkdtempSync(path.join(tmpdir(), 'review-broker-request-'))
	LANE.directory = path.join(state.directory, 'lane')
	resolve_mock.mockReturnValue(path.join(state.directory, '.git'))
	argv_mock.mockReset().mockReturnValue({
		kind: 'argv',
		argv: { command: 'codex', args: ['exec', '--sandbox', 'workspace-write'] },
		profile: REVIEWER_PROFILE,
	})
	launch_mock.mockReset().mockResolvedValue({ kind: 'completed', pid: 1, exit_code: 0 })
	emit_mock.mockReset().mockResolvedValue(undefined)
	reread_mock.mockReset().mockResolvedValue(undefined)
	lane_session_broker.take_refusal()
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(state.directory, { recursive: true, force: true })
})

async function served<T>(run: () => Promise<T>): Promise<T> {
	return await lane_session_broker.with_server(LANE, run)
}

describe('lane_session_broker — the request ship sends for its brokered reviews', () => {
	it("reads ship's request for both review slots and starts both reviewers", async () => {
		const slots = review_attest.REVIEW_SLOTS
		const answer = await served(
			async () => await run_ship_brokered_review.request(LANE.directory, ISSUE, '1', slots),
		)

		expect(answer).toStrictEqual(SUCCESS)
		expect(launch_mock).toHaveBeenCalledTimes(slots.length)
		expect(emit_mock).not.toHaveBeenCalled()
	})

	it('leaves no refusal mark for a request it read', async () => {
		await served(
			async () =>
				await run_ship_brokered_review.request(
					LANE.directory,
					ISSUE,
					'1',
					review_attest.REVIEW_SLOTS,
				),
		)

		expect(lane_session_broker.take_refusal()).toBe(false)
		expect(reread_mock).not.toHaveBeenCalled()
	})
})

describe('lane_session_broker — a refused request is read again by the code on disk', () => {
	it("answers with the fresh process's answer, and still marks the supervisor", async () => {
		reread_mock.mockResolvedValue(SUCCESS)

		const answer = await served(
			async () => await lane_session_broker.request(LANE.directory, ISSUE, NEWER),
		)

		expect(answer).toStrictEqual(SUCCESS)
		expect(reread_mock).toHaveBeenCalledWith(ISSUE, expect.objectContaining({ action: NEWER }))
		expect(lane_session_broker.take_refusal()).toBe(true)
	})

	it("passes on the fresh process's failure as the answer", async () => {
		const reason = 'the issue is parked'

		reread_mock.mockResolvedValue({ is_success: false, reason })

		const answer = await served(
			async () => await lane_session_broker.request(LANE.directory, ISSUE, NEWER),
		)

		expect(answer.is_success ? '' : answer.reason).toContain(reason)
	})
})

describe('lane_session_broker — a refused request marks the supervisor', () => {
	it('marks the refusal once, and clears the mark when taken', async () => {
		await served(async () => await lane_session_broker.request(LANE.directory, ISSUE, NEWER))

		expect([lane_session_broker.take_refusal(), lane_session_broker.take_refusal()]).toStrictEqual([
			true,
			false,
		])
	})

	it('reports the refusal as a version difference', async () => {
		const answer = await served(
			async () => await lane_session_broker.request(LANE.directory, ISSUE, NEWER),
		)

		expect(answer.is_success ? '' : answer.reason).toContain(
			"the broker's code differs from the ship's",
		)
	})
})
