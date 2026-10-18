import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park } from './run-park'

// joshuafolkken/kit#4132: the park record is what lets `lane-park` fall silent on a child that parked,
// so it is read back synchronously, keyed by repository and issue, and bounded.

const ISSUE = '4132'
const OTHER_ISSUE = '4133'
const REPOSITORY = mkdtempSync(path.join(tmpdir(), 'run-park-'))
const DIRECTORY = path.join(REPOSITORY, 'lane')
const NOW = new Date('2026-10-18T00:00:00.000Z')

beforeEach(() => {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(REPOSITORY)
})

afterEach(() => {
	run_park.clear(ISSUE, DIRECTORY)
	run_park.clear(OTHER_ISSUE, DIRECTORY)
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(REPOSITORY, { recursive: true, force: true })
})

describe('run_park', () => {
	it('reads an issue it recorded as parked', () => {
		expect(run_park.record(ISSUE, DIRECTORY, NOW)).toBe(true)
		expect(run_park.is_parked_sync(ISSUE, DIRECTORY, NOW)).toBe(true)
	})

	it('reads an issue with no record as not parked', () => {
		expect(run_park.is_parked_sync(ISSUE, DIRECTORY, NOW)).toBe(false)
	})

	// The record is keyed by issue, so one child's park never silences another's stop.
	it('reads another issue as not parked', () => {
		run_park.record(OTHER_ISSUE, DIRECTORY, NOW)

		expect(run_park.is_parked_sync(ISSUE, DIRECTORY, NOW)).toBe(false)
	})

	it('reads a cleared park as not parked', () => {
		run_park.record(ISSUE, DIRECTORY, NOW)
		run_park.clear(ISSUE, DIRECTORY)

		expect(run_park.is_parked_sync(ISSUE, DIRECTORY, NOW)).toBe(false)
	})

	// A label a person removed by hand must not leave the guard silent on the issue's next dispatch.
	it('reads a park past its bound as not parked', () => {
		run_park.record(ISSUE, DIRECTORY, NOW)
		const later = new Date(NOW.getTime() + run_park.PARK_MAX_AGE_MS + 1)

		expect(run_park.is_parked_sync(ISSUE, DIRECTORY, later)).toBe(false)
	})

	it('records nothing and reads not parked where git names no repository', () => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)

		expect(run_park.record(ISSUE, DIRECTORY, NOW)).toBe(false)
		expect(run_park.is_parked_sync(ISSUE, DIRECTORY, NOW)).toBe(false)
	})
})
