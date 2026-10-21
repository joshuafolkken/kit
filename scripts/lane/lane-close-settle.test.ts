import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneStateRecord } from './lane-state'

// joshuafolkken/kit#4300: a process that outlives a close's SIGKILL leaves the close `incomplete`,
// noted on the lane's record, and the supervisor closes the lane again once the process is gone.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { branch_exists: vi.fn(async () => false) },
}))
vi.mock('#scripts/git/git-worktree', () => ({
	git_worktree: {
		branch_delete: vi.fn(async () => ''),
		worktree_prune: vi.fn(async () => ''),
		worktree_remove: vi.fn(async () => ''),
	},
}))
vi.mock('./lane-registry', () => ({
	lane_registry: {
		find_lane: (): undefined => undefined,
		lane_root_directory: vi.fn(),
		list_lanes: vi.fn(async () => []),
	},
}))
vi.mock('./lane-reap', () => ({ lane_reap: { reap_child: vi.fn(() => []) } }))
vi.mock('./lane-residents', () => ({ lane_residents: { end_residents: vi.fn(() => []) } }))
const { SURVIVOR_TEXT } = vi.hoisted(() => ({ SURVIVOR_TEXT: 'the survivor' }))

vi.mock('./lane-reap-settle', () => ({
	lane_reap_settle: {
		settle: vi.fn(async () => []),
		survivor_texts: vi.fn((settled?: Array<unknown>) =>
			settled === undefined || settled.length > 0 ? [SURVIVOR_TEXT] : [],
		),
	},
}))
vi.mock('./lane-state', () => ({
	lane_state: {
		read_records: vi.fn(async () => []),
		read_state: vi.fn(),
		record_change: vi.fn(),
		record_stuck: vi.fn(),
	},
}))

const { lane_state } = await import('./lane-state')
const { lane_reap_settle } = await import('./lane-reap-settle')
const { lane_registry } = await import('./lane-registry')
const { lane_close } = await import('./lane-close')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-close-settle-'))
const LANE_ROOT = path.join(scratch, 'lanes')
const ISSUE = '4300'
const GONE_ISSUE = '4301'
const PRESENT_ISSUE = '4302'
const REOPENED_ISSUE = '4303'
const SURVIVOR = { pid: 20_611, reason: 'owned by root' }
const ENDED = { command: 'lane:close', issue: ISSUE, state: 'ended' }

function record_of(issue: string, state: LaneStateRecord['state']): LaneStateRecord {
	return { issue, state, changed_by: 'lane:open', changed_at: '2026-10-20T00:00:00.000Z' }
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

beforeEach(() => {
	vi.clearAllMocks()
	mkdirSync(path.join(LANE_ROOT, ISSUE), { recursive: true })
	vi.mocked(lane_registry.lane_root_directory).mockResolvedValue(LANE_ROOT)
})

describe('lane_close.close_lane — a process that outlived the SIGKILL', () => {
	it('answers incomplete, names the process and notes it on the record', async () => {
		vi.mocked(lane_reap_settle.settle).mockResolvedValueOnce([SURVIVOR])

		const outcome = await lane_close.close_lane(ISSUE)

		expect(outcome.kind).toBe('incomplete')
		expect(outcome.left_behind).toContain(SURVIVOR_TEXT)
		expect(lane_state.record_stuck).toHaveBeenCalledWith(ISSUE, [SURVIVOR])
		expect(lane_state.record_change).not.toHaveBeenCalled()
	})

	it('answers incomplete when the lane’s processes could not be read', async () => {
		vi.mocked(lane_reap_settle.settle).mockResolvedValueOnce(undefined)

		const outcome = await lane_close.close_lane(ISSUE)

		expect(outcome.kind).toBe('incomplete')
		expect(lane_state.record_stuck).not.toHaveBeenCalled()
	})

	it('clears what the record noted once nothing outlived the close', async () => {
		await lane_close.close_lane(ISSUE)

		expect(lane_state.record_stuck).toHaveBeenCalledWith(ISSUE, [])
	})

	it('ends the record of a lane a close already removed, once nothing is left', async () => {
		rmSync(path.join(LANE_ROOT, ISSUE), { force: true, recursive: true })
		vi.mocked(lane_state.read_state).mockResolvedValueOnce(record_of(ISSUE, 'open'))

		await expect(lane_close.close_lane(ISSUE)).resolves.toMatchObject({ kind: 'none' })
		expect(lane_state.record_change).toHaveBeenCalledWith(ENDED)
	})
})

describe('lane_close.retry_closes', () => {
	it('closes again only a lane not ended whose work tree is gone', async () => {
		mkdirSync(path.join(LANE_ROOT, PRESENT_ISSUE), { recursive: true })
		vi.mocked(lane_state.read_records).mockResolvedValueOnce([
			record_of(ISSUE, 'ended'),
			record_of(GONE_ISSUE, 'open'),
			record_of(PRESENT_ISSUE, 'open'),
		])

		await expect(lane_close.retry_closes()).resolves.toStrictEqual({
			closed: [GONE_ISSUE],
			failed: [],
		})
	})

	it('leaves a lane opened again while an earlier close waited', async () => {
		vi.mocked(lane_state.read_records).mockResolvedValueOnce([
			record_of(GONE_ISSUE, 'open'),
			record_of(REOPENED_ISSUE, 'open'),
		])
		vi.mocked(lane_reap_settle.settle).mockImplementationOnce(async () => {
			mkdirSync(path.join(LANE_ROOT, REOPENED_ISSUE), { recursive: true })

			return []
		})

		await expect(lane_close.retry_closes()).resolves.toStrictEqual({
			closed: [GONE_ISSUE],
			failed: [],
		})
	})
})
