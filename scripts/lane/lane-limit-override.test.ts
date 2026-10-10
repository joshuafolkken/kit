import { randomUUID } from 'node:crypto'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_limit_override } from './lane-limit-override'

// joshuafolkken/kit#3434: the live run's lane-limit override rides on its carry record, and a raise is a
// `lane-limit` event the `--wait` watcher sees. Each test keys a repository of its own, so the records
// it writes are never the live run's.

const OVERRIDE_LIMIT = 8
const RAISE_TEXT = 'lane limit 6 → 8'

const scratch = { repository: '' }

function carry_target(): string {
	return run_carry.carry_path(scratch.repository)
}

beforeEach(() => {
	scratch.repository = `/lane-limit-override-test/${randomUUID()}`
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(scratch.repository)
})

afterEach(() => {
	run_carry.end_carry(carry_target())
	stamp_file.remove_stamp(run_event_stream.target_of(scratch.repository))
	vi.restoreAllMocks()
})

describe('lane_limit_override — with no run in progress', () => {
	it('reads no override', async () => {
		await expect(lane_limit_override.read_override()).resolves.toBeUndefined()
	})

	it('refuses to write one', async () => {
		await expect(lane_limit_override.write_override(OVERRIDE_LIMIT)).resolves.toBe(false)
	})
})

describe('lane_limit_override — on a live run', () => {
	beforeEach(() => {
		run_carry.begin_carry(carry_target(), 'backlogrun')
	})

	it('reads back the override it wrote', async () => {
		await expect(lane_limit_override.write_override(OVERRIDE_LIMIT)).resolves.toBe(true)
		await expect(lane_limit_override.read_override()).resolves.toBe(OVERRIDE_LIMIT)
	})

	it('clears the override on undefined, keeping the run', async () => {
		await lane_limit_override.write_override(OVERRIDE_LIMIT)
		await lane_limit_override.write_override(undefined)

		await expect(lane_limit_override.read_override()).resolves.toBeUndefined()
		expect(run_carry.read_carry(carry_target()).kind).toBe('carried')
	})
})

describe('lane_limit_override.watch_raise', () => {
	it('sees a raise written after it started', async () => {
		const is_raised = await lane_limit_override.watch_raise()

		expect(is_raised()).toBe(false)

		await lane_limit_override.emit_raise(RAISE_TEXT)

		expect(is_raised()).toBe(true)
	})

	it('does not see a raise written before it started', async () => {
		await lane_limit_override.emit_raise(RAISE_TEXT)

		const is_raised = await lane_limit_override.watch_raise()

		expect(is_raised()).toBe(false)
	})
})
