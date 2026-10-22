import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4481: every writer of an ending emits through `emit`, which records the child's lane
// time on the event once, from the stream's launch or the lane record's.

const git_directories_mock = vi.hoisted(() => vi.fn())
const read_state_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: git_directories_mock },
}))

vi.mock('#scripts/lane/lane-state', () => ({ lane_state: { read_state: read_state_mock } }))

const { run_event_stream_emit } = await import('./run-event-stream-emit')
const { run_event_stream } = await import('./run-event-stream')

const KIND = run_event_stream.EVENT_KIND
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-ending-'))
const LAUNCHED_AT = new Date('2026-10-22T07:09:38.000Z')
const ENDED_AT = new Date('2026-10-22T07:17:30.000Z')
const MERGED_TEXT = '#4430 merged'
const IN_LANE_MS = ENDED_AT.getTime() - LAUNCHED_AT.getTime()
const RECORD = {
	issue: '4430',
	state: 'ended',
	launched_at: LAUNCHED_AT.toISOString(),
	changed_at: ENDED_AT.toISOString(),
	changed_by: 'lane:close',
}

beforeEach(() => {
	git_directories_mock.mockReset()
	read_state_mock.mockReset()
	git_directories_mock.mockResolvedValue(['/repo/.git/worktrees/lane', TEMPORARY])
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

// The newest event on the stream, removing the stream afterwards.
async function newest_event(): Promise<unknown> {
	const target = run_event_stream.target_of(TEMPORARY)
	const newest = run_event_stream.read_events(target).at(-1)

	rmSync(target, { force: true })

	return newest
}

describe('run_event_stream_emit.emit -- an ending records its lane time', () => {
	it('records the time since the launch on a merge', async () => {
		read_state_mock.mockResolvedValue(RECORD)
		await run_event_stream_emit.emit(KIND.CHILD_LAUNCH, '#4430', LAUNCHED_AT)
		await run_event_stream_emit.emit(KIND.MERGE, MERGED_TEXT, ENDED_AT)

		expect(await newest_event()).toMatchObject({ kind: KIND.MERGE, elapsed_ms: IN_LANE_MS })
	})

	it('records the time from the lane record when the stream holds no launch', async () => {
		read_state_mock.mockResolvedValue(RECORD)
		await run_event_stream_emit.emit(KIND.WITHDRAW, '#4430 withdrawn by a person: x', ENDED_AT)

		expect(await newest_event()).toMatchObject({ kind: KIND.WITHDRAW, elapsed_ms: IN_LANE_MS })
	})

	it('records nothing on an event that does not end a child', async () => {
		read_state_mock.mockResolvedValue(RECORD)
		await run_event_stream_emit.emit(KIND.CUT, '#4430 cut', ENDED_AT)

		expect(await newest_event()).not.toHaveProperty('elapsed_ms')
	})
})

describe('run_event_stream_emit -- an ending with no time, or appended by hand', () => {
	it('still writes the ending, with no time, when the lane record cannot be read', async () => {
		read_state_mock.mockRejectedValue(new Error('unreadable'))
		await run_event_stream_emit.emit(KIND.MERGE, MERGED_TEXT, ENDED_AT)

		const newest = await newest_event()

		expect(newest).toMatchObject({ kind: KIND.MERGE })
		expect(newest).not.toHaveProperty('elapsed_ms')
	})

	it('records the time on an ending appended by hand through append_at', async () => {
		read_state_mock.mockResolvedValue(RECORD)
		await run_event_stream_emit.append_at(
			run_event_stream.target_of(TEMPORARY),
			KIND.STOP,
			'#4430 run stopped',
			ENDED_AT,
		)

		expect(await newest_event()).toMatchObject({ kind: KIND.STOP, elapsed_ms: IN_LANE_MS })
	})

	it('records nothing for a child with no lane record', async () => {
		read_state_mock.mockResolvedValue(undefined)
		await run_event_stream_emit.emit(KIND.PARK, '#4430 parked', ENDED_AT)

		expect(await newest_event()).not.toHaveProperty('elapsed_ms')
	})
})
