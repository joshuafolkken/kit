import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import type { DrivePorts, DriveState } from './backlog-drive'
import { backlog_drive_adopt } from './backlog-drive-adopt'
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
const READMITTED = [...WITHDRAWN, event(3, 'add', 'retry #2508')]

describe('backlog_drive_restore — a withdrawal a person put back', () => {
	it('offers a withdrawn child again after run:add --retry', () => {
		expect(backlog_drive_restore.offer_exclude(WITHDRAWN)).toStrictEqual([CHILD])
		expect(backlog_drive_restore.offer_exclude(READMITTED)).toStrictEqual([])
		expect(backlog_drive_restore.left_out(READMITTED, []).exclude).toStrictEqual([])
	})

	it('keeps a withdrawn child out after an ordinary add', () => {
		const added = [...WITHDRAWN, event(3, 'add', 'added #2508')]

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

describe('backlog_drive_record — the production re-admission port', () => {
	it('reads the tick stream for re-admitted withdrawals', async () => {
		const { readmit } = backlog_drive_record.record_ports(async () => await READMITTED)

		expect(await readmit([MERGED, CHILD])).toStrictEqual([MERGED])
	})

	it('keeps the exclusion when the stream cannot be read', async () => {
		const { readmit } = backlog_drive_record.record_ports(async () => {
			throw new Error('unreadable stream')
		})

		expect(await readmit([CHILD])).toStrictEqual([CHILD])
	})
})
