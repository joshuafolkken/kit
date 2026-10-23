import type { BrokerAnswer } from '#scripts/lane/lane-session-action'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Map<string, string>())

vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: (source: string) => files.get(source),
		remove_stamp: (target: string) => files.delete(target),
		stamp_path: (prefix: string, directory: string, extension: string) =>
			`${directory}/${prefix}${extension}`,
		write_text_stamp: (target: string, text: string) => files.set(target, text),
	},
}))

const { run_ship_brokered_review } = await import('./run-ship-brokered-review')
const { lane_session_broker } = await import('#scripts/lane/lane-session-broker')
const broker_request = vi.spyOn(lane_session_broker, 'request')

// joshuafolkken/kit#4672: the reviewers a lane's broker starts, and the fallback for a broker on the
// code before the review slots.

const DIRECTORY = 'lane'
const ISSUE = '4672'
const SUCCESS: BrokerAnswer = { is_success: true }
const UNREADABLE: BrokerAnswer = {
	is_success: false,
	reason:
		'the broker answered a failure: the broker could not read the request — unrecognized key: action.slots',
}
const CODE = lane_session_broker.review_paths(DIRECTORY, 'code')
const INTERACTION = lane_session_broker.review_paths(DIRECTORY, 'interaction')
const CODE_BRIEF = 'code brief'
const INTERACTION_BRIEF = 'interaction brief'
const BOTH = ['code', 'interaction'] as const
const STOPPED: BrokerAnswer = {
	is_success: false,
	reason: 'the broker stopped serving before it answered',
}

// What an older broker's reviewer does: reads the code slot's brief and answers in its findings.
function review_as_older_broker(): void {
	broker_request.mockImplementation(async (_directory, _issue, action) => {
		if (action.kind === 'review' && action.slots !== undefined) return UNREADABLE

		files.set(CODE.findings, `reviewed: ${files.get(CODE.brief) ?? ''}`)

		return SUCCESS
	})
}

beforeEach(() => {
	files.clear()
	files.set(CODE.brief, CODE_BRIEF)
	files.set(INTERACTION.brief, INTERACTION_BRIEF)
	broker_request.mockReset().mockResolvedValue(SUCCESS)
})

describe('run_ship_brokered_review.request', () => {
	it('asks for `/code-review` alone without slots', async () => {
		expect(await run_ship_brokered_review.request(DIRECTORY, ISSUE, '1', ['code'])).toBe(SUCCESS)
		expect(broker_request).toHaveBeenCalledExactlyOnceWith(DIRECTORY, ISSUE, {
			kind: 'review',
			round: '1',
		})
	})

	it('asks for both slots in one request', async () => {
		expect(await run_ship_brokered_review.request(DIRECTORY, ISSUE, '1', BOTH)).toBe(SUCCESS)
		expect(broker_request).toHaveBeenCalledExactlyOnceWith(DIRECTORY, ISSUE, {
			kind: 'review',
			round: '1',
			slots: BOTH,
		})
	})

	it('reviews each slot in turn through the code files when the broker cannot read slots', async () => {
		review_as_older_broker()

		expect(await run_ship_brokered_review.request(DIRECTORY, ISSUE, '1', BOTH)).toStrictEqual(
			SUCCESS,
		)
		expect(broker_request).toHaveBeenCalledTimes(3)
		expect(files.get(INTERACTION.findings)).toBe(`reviewed: ${INTERACTION_BRIEF}`)
		expect(files.get(CODE.findings)).toBe(`reviewed: ${CODE_BRIEF}`)
		expect(files.get(CODE.brief)).toBe(CODE_BRIEF)
	})
})

describe('run_ship_brokered_review.request — a failed answer', () => {
	it('answers the first failure among the slots reviewed in turn', async () => {
		const failed: BrokerAnswer = { is_success: false, reason: 'reviewer exited 1' }

		broker_request
			.mockResolvedValueOnce(UNREADABLE)
			.mockResolvedValueOnce(failed)
			.mockResolvedValueOnce(SUCCESS)

		expect(await run_ship_brokered_review.request(DIRECTORY, ISSUE, '1', BOTH)).toBe(failed)
		expect(files.has(INTERACTION.findings)).toBe(false)
	})

	it('answers any other failure as it is, without falling back', async () => {
		broker_request.mockResolvedValue(STOPPED)

		expect(await run_ship_brokered_review.request(DIRECTORY, ISSUE, '1', BOTH)).toBe(STOPPED)
		expect(broker_request).toHaveBeenCalledOnce()
	})
})

describe('lane_session_broker.is_unreadable', () => {
	it('reads the unreadable answer as such and no other failure', () => {
		expect(lane_session_broker.is_unreadable(UNREADABLE)).toBe(true)
		expect(lane_session_broker.is_unreadable(STOPPED)).toBe(false)
		expect(lane_session_broker.is_unreadable(SUCCESS)).toBe(false)
	})
})
