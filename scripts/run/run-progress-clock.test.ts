import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_progress_clock } from './run-progress-clock'

// joshuafolkken/kit#1821: the watcher's own liveness record, kept apart from the report clock. The
// watcher writes it, reads it every tick, and stops when it is gone; `josh followup` removes it at the
// merge. The read/write is `stamp_file` and the record is presence-only, so these drive it through a
// real temp file rather than a mock.
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-life-record-'))

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('the watcher liveness record', () => {
	it('reads as ended before the watcher has begun', () => {
		const target = path.join(TEMPORARY, 'absent.json')

		expect(run_progress_clock.is_life_ended(target)).toBe(true)
	})

	it('reads as alive once the watcher has begun, and ended once it is removed', () => {
		const target = path.join(TEMPORARY, 'alive.json')

		run_progress_clock.begin_life(target)
		expect(run_progress_clock.is_life_ended(target)).toBe(false)

		run_progress_clock.end_life(target)
		expect(run_progress_clock.is_life_ended(target)).toBe(true)
	})

	// A `--wait` the caller restarts must cleanly replace a record an earlier one left, so beginning
	// twice is a refresh rather than an error.
	it('refreshes an existing record rather than failing', () => {
		const target = path.join(TEMPORARY, 'refresh.json')

		run_progress_clock.begin_life(target)
		run_progress_clock.begin_life(target)

		expect(run_progress_clock.is_life_ended(target)).toBe(false)
	})

	// Removing an absent record is what `josh followup` does when no watcher ran, so it must be safe.
	it('is safe to end a record that was never begun', () => {
		const target = path.join(TEMPORARY, 'never.json')

		expect(() => {
			run_progress_clock.end_life(target)
		}).not.toThrow()
	})
})

describe('the liveness record is a separate file from the report clock', () => {
	// Removing the liveness record must not disturb the report clock the early-heartbeat guard reads,
	// so the two key on the same directory through different prefixes.
	it('keys on the same directory but resolves a different file', () => {
		const directory = '/scratch/.git'

		expect(run_progress_clock.life_target_of(directory)).not.toBe(
			run_progress_clock.stamp_target_of(directory),
		)
	})

	it('builds its path from the life prefix', () => {
		expect(run_progress_clock.LIFE_PREFIX).toBe('josh-run-progress-life-')
	})
})
