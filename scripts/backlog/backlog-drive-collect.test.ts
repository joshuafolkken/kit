import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_driver } from '#scripts/run/merge/run-merge-driver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_after_merge } from './backlog-drive-after-merge'
import { backlog_drive_collect } from './backlog-drive-collect'
import { backlog_drive_owner } from './backlog-drive-owner'

// joshuafolkken/kit#6677: the driver's collection of a child is opened and closed on the stream, so
// the wait before it is collected names what the driver was doing.

const ISSUE = '2500'
const OWNER = '4242'
const CARRY = run_carry.fresh_carry('backlogrun', run_carry.NO_OWNER, new Date(0))
const MERGED: MergeResult = { token: '2600', code: 0, outcome: 'merged', is_offer: true }

function emitted(): ReadonlyArray<string> {
	return vi.mocked(run_event_stream_emit.emit).mock.calls.map(([, text]) => text)
}

beforeEach(() => {
	vi.spyOn(backlog_drive_owner, 'assert_current').mockResolvedValue(CARRY)
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
	vi.spyOn(backlog_drive_after_merge, 'after_merge').mockResolvedValue()
	// The checkout's stream is a live run's: never written from a test.
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_collect.merge', () => {
	it('runs run:merge inside a collect trace', async () => {
		vi.spyOn(josh_command, 'josh_run').mockImplementation(async () => {
			expect(emitted()).toStrictEqual([`#${ISSUE} collect start`])

			return { code: 0, out: run_merge_driver.print(MERGED) }
		})

		await expect(backlog_drive_collect.merge(ISSUE, OWNER)).resolves.toStrictEqual(MERGED)
		expect(emitted()).toStrictEqual([`#${ISSUE} collect start`, `#${ISSUE} collect done`])
	})

	it('closes the trace as failed when the collection throws', async () => {
		const failure = new Error('spawn failed')

		vi.spyOn(josh_command, 'josh_run').mockRejectedValue(failure)

		await expect(backlog_drive_collect.merge(ISSUE, OWNER)).rejects.toBe(failure)
		expect(emitted()).toStrictEqual([`#${ISSUE} collect start`, `#${ISSUE} collect failed`])
	})
})
