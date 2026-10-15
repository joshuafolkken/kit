import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import type { RunHold } from '#scripts/run/hold/run-hold'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_decline } from './run-cut-decline'

// joshuafolkken/kit#3881: once `run:cut --impl` answered `not-a-lane` / `unready`, the guard still
// refused an edit every reissue window. The record keeps it silent for the rest of the same hold.

const ISSUE = '3881'
const TAKEN_AT = '2026-10-16T00:00:00.000Z'
const DIRECTORY = mkdtempSync(path.join(tmpdir(), 'run-cut-decline-'))

function hold_taken(taken_at: string): RunHold {
	return { issue: ISSUE, taken_at, pid: 1, is_fullrun: true }
}

const hold_of = vi.spyOn(run_cut, 'hold_of')

afterEach(() => {
	stamp_file.remove_stamp(run_cut_decline.decline_path(DIRECTORY))
	hold_of.mockReset()
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(DIRECTORY, { force: true, recursive: true })
})

describe('run_cut_decline.is_declined_sync', () => {
	it('is silent for the issue and the hold the decline was recorded under', () => {
		hold_of.mockReturnValue(hold_taken(TAKEN_AT))
		run_cut_decline.record(DIRECTORY, { issue: ISSUE, hold_taken_at: TAKEN_AT })

		expect(run_cut_decline.is_declined_sync(ISSUE, DIRECTORY)).toBe(true)
	})

	// A fresh hold is a new run, which may be able to cut, so it is asked again.
	it('asks again under a different hold', () => {
		hold_of.mockReturnValue(hold_taken('2026-10-16T01:00:00.000Z'))
		run_cut_decline.record(DIRECTORY, { issue: ISSUE, hold_taken_at: TAKEN_AT })

		expect(run_cut_decline.is_declined_sync(ISSUE, DIRECTORY)).toBe(false)
	})

	it('asks again for another issue', () => {
		hold_of.mockReturnValue(hold_taken(TAKEN_AT))
		run_cut_decline.record(DIRECTORY, { issue: '2294', hold_taken_at: TAKEN_AT })

		expect(run_cut_decline.is_declined_sync(ISSUE, DIRECTORY)).toBe(false)
	})

	it('asks when nothing was declined', () => {
		hold_of.mockReturnValue(hold_taken(TAKEN_AT))

		expect(run_cut_decline.is_declined_sync(ISSUE, DIRECTORY)).toBe(false)
	})
})
