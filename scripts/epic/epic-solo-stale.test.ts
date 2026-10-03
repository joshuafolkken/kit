import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { IN_PROGRESS_LABEL, RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
import { lane_await } from '#scripts/lane/lane-await'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BusyRead } from './epic-busy'
import { epic_solo_stale } from './epic-solo-stale'

// joshuafolkken/kit#3017: a `run:solo` holder no process is running for is taken out of the
// `in-progress` read, so a label nothing removed cannot hold the whole backlog.

const { issue } = auto_ok_fixture

const REPO = 'joshuafolkken/kit'
const SOLO_HOLDER = 2987
const LANE_HOLDER = 2990

const solo_row = issue(SOLO_HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL, RUN_SOLO_LABEL])
const lane_row = issue(LANE_HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL, RUN_LANE_LABEL])

function running_only(numbers: ReadonlyArray<number>): void {
	vi.spyOn(lane_await, 'is_process_running_default').mockImplementation((child) =>
		numbers.map(String).includes(child),
	)
}

function lanes_here(numbers: ReadonlyArray<number>): void {
	vi.spyOn(epic_solo_stale.io, 'local_lanes').mockResolvedValue(new Set(numbers.map(String)))
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(epic_solo_stale.io, 'settle').mockResolvedValue()
	lanes_here([SOLO_HOLDER, LANE_HOLDER])
})

describe('epic_solo_stale.release', () => {
	it('answers idle and names a run:solo holder no process is running for', async () => {
		running_only([])

		const released = await epic_solo_stale.release({ kind: 'busy', issues: [solo_row] }, REPO)

		expect(released.read).toEqual({ kind: 'idle' })
		expect(released.notice).toContain(`#${String(SOLO_HOLDER)}`)
		expect(released.notice).toContain('stale')
	})

	it('keeps a run:solo holder whose process is running', async () => {
		running_only([SOLO_HOLDER])

		const read: BusyRead = { kind: 'busy', issues: [solo_row] }
		const released = await epic_solo_stale.release(read, REPO)

		expect(released.read).toBe(read)
		expect(released.notice).toBeUndefined()
	})

	it('keeps an ordinary holder whatever its process says', async () => {
		running_only([])

		const released = await epic_solo_stale.release(
			{ kind: 'busy', issues: [solo_row, lane_row] },
			REPO,
		)

		expect(released.read).toEqual({ kind: 'busy', issues: [lane_row] })
		expect(released.notice).toContain(`#${String(SOLO_HOLDER)}`)
	})

	it.each<BusyRead>([{ kind: 'idle' }, { kind: 'unreadable' }, { kind: 'truncated' }])(
		'passes a $kind read through untouched',
		async (read) => {
			running_only([])

			expect(await epic_solo_stale.release(read, REPO)).toEqual({ read })
		},
	)
})

// A missing process is no evidence of an ended run unless this machine dispatched the holder, and a
// boundary cut drops the process for a moment.
describe('epic_solo_stale.release — keeps a holder it cannot prove ended', () => {
	it('keeps a run:solo holder with no lane on this machine', async () => {
		running_only([])
		lanes_here([])

		const read: BusyRead = { kind: 'busy', issues: [solo_row] }

		expect(await epic_solo_stale.release(read, REPO)).toEqual({ read })
	})

	it('keeps a run:solo holder whose process is back when re-confirmed', async () => {
		running_only([])
		vi.spyOn(epic_solo_stale.io, 'settle').mockImplementation(async () => {
			running_only([SOLO_HOLDER])
		})

		const read: BusyRead = { kind: 'busy', issues: [solo_row] }

		expect(await epic_solo_stale.release(read, REPO)).toEqual({ read })
	})
})
