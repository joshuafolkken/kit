import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DrivePorts, DriveState } from './backlog-drive'
import { backlog_drive_adopt } from './backlog-drive-adopt'
import { backlog_drive_args } from './backlog-drive-args'
import { backlog_drive_record } from './backlog-drive-record'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_drive_state } from './backlog-drive-state'

// joshuafolkken/kit#8599: a person's `run:add <N> --retry` puts an issue they withdrew from the live run
// back into its offer, while a bare withdrawal still keeps it out (joshuafolkken/kit#4365).

const CHILD = '2508'
const MERGED = '2509'
const DISPATCHED = '#2508 dispatched'
const CHILD_LAUNCH = 'child-launch'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-11-22T00:00:00.000Z' }
}

const WITHDRAWN = [
	event(1, CHILD_LAUNCH, DISPATCHED),
	event(2, 'withdraw', '#2508 withdrawn by a person'),
]
const ADD = 'add'
const RETRY = event(3, ADD, 'retry #2508')
const READMITTED = [...WITHDRAWN, RETRY]

describe('backlog_drive_restore — a withdrawal a person put back', () => {
	it('offers a withdrawn child again after run:add --retry', () => {
		expect(backlog_drive_restore.offer_exclude(WITHDRAWN)).toStrictEqual([CHILD])
		expect(backlog_drive_restore.offer_exclude(READMITTED)).toStrictEqual([])
		expect(backlog_drive_restore.left_out(READMITTED, []).exclude).toStrictEqual([])
	})

	it('keeps a withdrawn child out after an ordinary add', () => {
		const added = [...WITHDRAWN, event(3, ADD, 'added #2508')]

		expect(backlog_drive_restore.offer_exclude(added)).toStrictEqual([CHILD])
	})

	it('keeps a child withdrawn again after its re-admitted launch out of the offer', () => {
		const again = [
			...READMITTED,
			event(4, CHILD_LAUNCH, DISPATCHED),
			event(5, 'withdraw', '#2508 withdrawn again'),
		]

		expect(backlog_drive_restore.withdrawn_issues(again)).toStrictEqual([CHILD])
	})

	it('drops only re-admitted withdrawals from a held exclusion', () => {
		expect(backlog_drive_restore.without_readmitted([MERGED, CHILD], READMITTED)).toStrictEqual([
			MERGED,
		])
		expect(backlog_drive_restore.without_readmitted([MERGED, CHILD], WITHDRAWN)).toStrictEqual([
			MERGED,
			CHILD,
		])
	})
})

// joshuafolkken/kit#8665: the yield cap's park is lifted by a retry too, as #8412 was on 2026-11-22.
const CAP_PARK = '#2508 parked (run:stalled: yield cap)'
const CAPPED = [event(1, CHILD_LAUNCH, DISPATCHED), event(2, 'park', CAP_PARK)]
const CAPPED_RETRIED = [...CAPPED, RETRY]

describe('backlog_drive_restore — a yield-capped park a retry put back', () => {
	it('drops a yield-capped child from a held exclusion once it is retried', () => {
		const held = [MERGED, CHILD]

		expect(backlog_drive_restore.without_readmitted(held, CAPPED_RETRIED)).toStrictEqual([MERGED])
	})

	it('keeps a yield-capped child out until a retry comes, and after a second cap', () => {
		const again = [...CAPPED_RETRIED, event(4, 'park', CAP_PARK)]

		expect(backlog_drive_restore.without_readmitted([CHILD], CAPPED)).toStrictEqual([CHILD])
		expect(backlog_drive_restore.without_readmitted([CHILD], again)).toStrictEqual([CHILD])
	})

	it('keeps a retried yield-capped child out once the retried attempt merged', () => {
		const merged = [...CAPPED_RETRIED, event(4, 'merge', '#2508 merged')]

		expect(backlog_drive_restore.without_readmitted([CHILD], merged)).toStrictEqual([CHILD])
	})

	it('keeps a child parked for another cause out after a retry', () => {
		const other = [event(2, 'park', '#2508 parked (run:stalled: ship-stop cap)'), RETRY]

		expect(backlog_drive_restore.without_readmitted([CHILD], other)).toStrictEqual([CHILD])
	})
})

describe('backlog_drive_restore.left_out — a carried yield-capped exclusion', () => {
	it('drops a carried --exclude entry once its yield-capped issue is retried', () => {
		const carried = [MERGED, CHILD]

		expect(backlog_drive_restore.left_out(CAPPED_RETRIED, carried).exclude).toStrictEqual([MERGED])
		expect(backlog_drive_restore.left_out(CAPPED, [CHILD]).exclude).toStrictEqual([CHILD])
	})

	it('leaves a lifted exclusion off the resume line', () => {
		const context = backlog_drive_args.parse(['--owner', '1', '--exclude', `${MERGED},${CHILD}`])
		const state: DriveState = {
			...backlog_drive_state.initial_state([], '2'),
			...backlog_drive_restore.left_out(CAPPED_RETRIED, context?.exclude ?? []),
		}
		const line = context && backlog_drive_args.resume_line(state, context)

		expect(line).toContain(`--exclude ${MERGED}`)
		expect(line).not.toContain(CHILD)
	})
})

async function exclusion_of(
	should_offer: boolean,
	readmit?: DrivePorts['readmit'],
): Promise<ReadonlyArray<string>> {
	const state: DriveState = {
		...backlog_drive_state.initial_state([], '2'),
		exclude: [MERGED, CHILD],
	}
	const held = await backlog_drive_adopt.held(state, should_offer, {
		adoptable: async () => [],
		...(readmit !== undefined && { readmit }),
	})

	return held.exclude
}

describe('backlog_drive_adopt.held — the live drive re-admits', () => {
	it('takes the re-admitted withdrawal out of the in-memory exclusion on an offered pass', async () => {
		const readmit = vi.fn(async () => [MERGED])

		expect(await exclusion_of(true, readmit)).toStrictEqual([MERGED])
		expect(readmit).toHaveBeenCalledWith([MERGED, CHILD])
	})

	it('keeps the exclusion without a re-admission port or an offer', async () => {
		const readmit = vi.fn(async () => [])

		expect(await exclusion_of(true)).toStrictEqual([MERGED, CHILD])
		expect(await exclusion_of(false, readmit)).toStrictEqual([MERGED, CHILD])
		expect(readmit).not.toHaveBeenCalled()
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_record — the production re-admission port', () => {
	it('reads the tick stream for re-admitted withdrawals', async () => {
		const { readmit } = backlog_drive_record.record_ports(async () => await READMITTED)

		expect(await readmit([MERGED, CHILD])).toStrictEqual([MERGED])
	})

	it('reads the run stream itself when no tick read is given', async () => {
		const stream_target = vi
			.spyOn(run_event_stream_emit, 'stream_target')
			.mockResolvedValue(undefined)
		const { readmit } = backlog_drive_record.record_ports()

		expect(await readmit([CHILD])).toStrictEqual([CHILD])
		expect(stream_target).toHaveBeenCalledOnce()
	})

	it('keeps the exclusion when the stream cannot be read', async () => {
		const { readmit } = backlog_drive_record.record_ports(async () => {
			throw new Error('unreadable stream')
		})

		expect(await readmit([CHILD])).toStrictEqual([CHILD])
	})
})
