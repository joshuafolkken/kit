import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_session_action } from './lane-session-action'
import { lane_session_reread } from './lane-session-reread'

// joshuafolkken/kit#4732: a request the supervisor's loaded code refused, read again by the code on disk.

const execa_mock = vi.hoisted(() => vi.fn())
const find_mock = vi.hoisted(() => vi.fn())
const ISSUE = '4732'
const SUCCESS = { is_success: true }
const SESSION = '0b7f6a5e-1c2d-4e3f-8a9b-0c1d2e3f4a5b'
const NONCE = '1c8e7b6f-2d3e-4f5a-9b0c-1d2e3f4a5b6c'
const STOP = { stage: 'review', title: 'Title #4732', flags: [], is_review: true, conflicts: [] }
const LANE: LaneInfo = {
	issue: ISSUE,
	directory: '/registered/lane',
	branch: '4732-lane',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile: undefined,
}

vi.mock('execa', () => ({ execa: execa_mock }))
vi.mock('./lane-registry', () => ({ lane_registry: { find_open_lane: find_mock } }))

function request_text(action: object): string {
	return JSON.stringify({ session: SESSION, nonce: NONCE, action })
}

beforeEach(() => {
	execa_mock.mockReset()
	find_mock.mockReset().mockResolvedValue(LANE)
	vi.spyOn(lane_session_action, 'answer').mockResolvedValue(lane_session_action.SUCCESS)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_session_reread.answer_text — the fresh process reads with the code on disk', () => {
	it('performs a request the schema on disk reads, and returns its answer', async () => {
		const action = { kind: 'relaunch', stop: STOP }

		await expect(
			lane_session_reread.answer_text(ISSUE, request_text(action)),
		).resolves.toStrictEqual(SUCCESS)
		expect(lane_session_action.answer).toHaveBeenCalledWith(LANE, action)
	})

	it('reads nothing where the schema on disk refuses the request too', async () => {
		const action = { kind: 'review', round: '1', is_from_newer_main: true }

		await expect(
			lane_session_reread.answer_text(ISSUE, request_text(action)),
		).resolves.toBeUndefined()
		expect(lane_session_action.answer).not.toHaveBeenCalled()
	})

	it('reads nothing where no open lane carries the issue', async () => {
		find_mock.mockResolvedValue(undefined)

		await expect(
			lane_session_reread.answer_text(ISSUE, request_text({ kind: 'review', round: '1' })),
		).resolves.toBeUndefined()
		expect(lane_session_action.answer).not.toHaveBeenCalled()
	})
})

describe('lane_session_reread.reread — the supervisor reads the fresh process answer', () => {
	it('starts the sibling entry under the same runner with the issue and the request', async () => {
		execa_mock.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify(SUCCESS) })
		const received = { session: SESSION, nonce: NONCE }

		await expect(lane_session_reread.reread(ISSUE, received)).resolves.toStrictEqual(SUCCESS)
		expect(execa_mock).toHaveBeenCalledWith(
			process.execPath,
			[
				...process.execArgv,
				expect.stringMatching(/lane-session-reread-main\.ts$/u),
				ISSUE,
				JSON.stringify(received),
			],
			expect.anything(),
		)
	})

	it('reads the answer off the last line, past anything printed before it', async () => {
		const failure = { is_success: false, reason: 'the issue is parked' }

		execa_mock.mockResolvedValue({ exitCode: 0, stdout: `noise\n${JSON.stringify(failure)}\n` })

		await expect(lane_session_reread.reread(ISSUE, {})).resolves.toStrictEqual(failure)
	})

	it('returns nothing where the fresh process read nothing', async () => {
		execa_mock.mockResolvedValue({ exitCode: 1, stdout: '' })

		await expect(lane_session_reread.reread(ISSUE, {})).resolves.toBeUndefined()
	})

	it('returns nothing where the fresh process printed no answer', async () => {
		execa_mock.mockResolvedValue({ exitCode: 0, stdout: 'not an answer' })

		await expect(lane_session_reread.reread(ISSUE, {})).resolves.toBeUndefined()
	})
})
