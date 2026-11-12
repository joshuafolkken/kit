import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_hold, type HoldRead } from './run-hold'
import { run_hold_block } from './run-hold-block'

// joshuafolkken/kit#5352: `run:entry` and `run:handoff` ask one rule for what stops a claim.

const HOLD = { issue: '12', taken_at: '2026-11-01T00:00:00.000Z', pid: 42 }
const HELD: HoldRead = { kind: 'held', hold: HOLD }
const STALE: HoldRead = { kind: 'stale', hold: HOLD }

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_hold_block.blocking_message', () => {
	it('blocks a claim on a tree another issue holds', async () => {
		expect(await run_hold_block.blocking_message(HELD, '13')).toBe(run_hold.held_message(HOLD))
	})

	it('lets the held issue claim its own tree again', async () => {
		expect(await run_hold_block.blocking_message(HELD, '12')).toBeUndefined()
	})

	it('blocks a claim on an unreadable record', async () => {
		const read: HoldRead = { kind: 'unreadable' }

		expect(await run_hold_block.blocking_message(read, '12')).toBe(run_hold.unreadable_message())
	})

	it('blocks a claim on an expired record while the tree is dirty', async () => {
		vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(true)

		expect(await run_hold_block.blocking_message(STALE, '13')).toBe(
			run_hold.uncommitted_message(HOLD),
		)
	})

	it('lets a claim through on a free tree', async () => {
		expect(await run_hold_block.blocking_message({ kind: 'free' }, '13')).toBeUndefined()
	})
})
