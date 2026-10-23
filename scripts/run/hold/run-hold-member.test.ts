import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold, type RunHold } from './run-hold'
import { run_hold_member } from './run-hold-member'

// joshuafolkken/kit#4099: only a run's own session — a lane child or the one holding the run's hold —
// files as the run, and an owner nobody recorded is read as outside.

const OWN_PID = 4242
const OTHER_PID = 4343
const OWN = { owner_pid: OWN_PID, owner_start: 'Thu Oct  1 00:00:00 2026' }
const HOLD: RunHold = { issue: '7', taken_at: '2026-10-01T00:00:00.000Z', pid: OWN_PID }

const marked_issue = vi.spyOn(lane_child_marker, 'marked_issue')
const worktree_directory = vi.spyOn(run_hold, 'worktree_directory')
const read_hold = vi.spyOn(run_hold, 'read_hold')

function held(hold: RunHold): void {
	read_hold.mockReturnValue({ kind: 'held', hold })
}

beforeEach(() => {
	marked_issue.mockReturnValue(undefined)
	worktree_directory.mockResolvedValue('.git')
	held({ ...HOLD, ...OWN })
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('run_hold_member.is_run_member', () => {
	it('reads a lane child as the run’s', async () => {
		marked_issue.mockReturnValue('7')
		worktree_directory.mockResolvedValue(undefined)

		await expect(run_hold_member.is_run_member(OWN)).resolves.toBe(true)
	})

	it('reads the session holding the run’s hold as the run’s', async () => {
		await expect(run_hold_member.is_run_member(OWN)).resolves.toBe(true)
	})

	it.each([
		['another process holds it', { ...HOLD, ...OWN, owner_pid: OTHER_PID }, OWN],
		['the hold records no owner', HOLD, OWN],
		['the session reads no owner', { ...HOLD, ...OWN }, {}],
	])('reads the session as outside when %s', async (_label, hold, owner) => {
		held(hold)

		await expect(run_hold_member.is_run_member(owner)).resolves.toBe(false)
	})

	it('reads the session as outside where no run holds the tree', async () => {
		read_hold.mockReturnValue({ kind: 'free' })

		await expect(run_hold_member.is_run_member(OWN)).resolves.toBe(false)
	})

	it('reads the session as outside where it is in no working tree', async () => {
		worktree_directory.mockResolvedValue(undefined)

		await expect(run_hold_member.is_run_member(OWN)).resolves.toBe(false)
	})
})
