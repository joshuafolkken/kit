import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { repository_lock } from './repository-lock'

// Pins the current behavior of the shared repository lock directly, beside the stash-sweep wrapper's
// own tests: acquire, release, contention, stale reclaim and an unreadable record.

const NO_WAIT_MS = 0
// Long enough for one poll interval to pass while the holder lets go, short enough to keep the suite fast.
const SHORT_WAIT_MS = 2000
const RELEASE_DELAY_MS = 50
// A pid far above any real process table, so it reads as a process that is certainly gone.
const DEAD_PID = 2_147_483_000
const DONE = 'done'
const PREFIX = 'josh-repository-lock-test-'
const OTHER_PREFIX = 'josh-repository-lock-other-'
const CORRUPT_RECORD = '{not json'

const state = { scratch: '', lock: '' }

async function work(): Promise<string> {
	return DONE
}

async function failing_work(): Promise<string> {
	throw new Error('boom')
}

function live_record(): string {
	return JSON.stringify({ pid: process.ppid })
}

beforeEach(() => {
	state.scratch = mkdtempSync(path.join(tmpdir(), 'repository-lock-test-'))
	state.lock = path.join(state.scratch, 'lock.json')
})

afterEach(() => {
	rmSync(state.scratch, { force: true, recursive: true })
})

describe('repository_lock.with_lock acquire and release', () => {
	it('runs the work, answers its result and removes the lock afterwards', async () => {
		const result = await repository_lock.with_lock(work, state.lock, NO_WAIT_MS)

		expect(result).toBe(DONE)
		expect(existsSync(state.lock)).toBe(false)
	})

	it('holds a record naming this process while the work runs', async () => {
		const seen = await repository_lock.with_lock(
			async () => readFileSync(state.lock, 'utf8'),
			state.lock,
			NO_WAIT_MS,
		)

		expect(seen).toContain(`"pid":${String(process.pid)}`)
	})

	it('releases the lock when the work throws', async () => {
		await expect(repository_lock.with_lock(failing_work, state.lock, NO_WAIT_MS)).rejects.toThrow(
			'boom',
		)
		expect(existsSync(state.lock)).toBe(false)
	})

	it('leaves a record another process wrote during the work in place on release', async () => {
		await repository_lock.with_lock(
			async () => {
				writeFileSync(state.lock, live_record())
			},
			state.lock,
			NO_WAIT_MS,
		)

		expect(readFileSync(state.lock, 'utf8')).toBe(live_record())
	})
})

describe('repository_lock.with_lock contention', () => {
	it('does not run the work while a live process holds the lock', async () => {
		writeFileSync(state.lock, live_record())
		const spy = vi.fn(work)

		const result = await repository_lock.with_lock(spy, state.lock, NO_WAIT_MS)

		expect(result).toBeUndefined()
		expect(spy).not.toHaveBeenCalled()
		expect(readFileSync(state.lock, 'utf8')).toBe(live_record())
	})

	it('waits and then acquires once the holder lets go within the wait', async () => {
		writeFileSync(state.lock, live_record())
		setTimeout(() => {
			rmSync(state.lock, { force: true })
		}, RELEASE_DELAY_MS)

		const result = await repository_lock.with_lock(work, state.lock, SHORT_WAIT_MS)

		expect(result).toBe(DONE)
		expect(existsSync(state.lock)).toBe(false)
	})
})

describe('repository_lock stale and unreadable records', () => {
	it('reclaims a lock whose owner process is gone', async () => {
		writeFileSync(state.lock, JSON.stringify({ pid: DEAD_PID }))

		const result = await repository_lock.with_lock(work, state.lock, NO_WAIT_MS)

		expect(result).toBe(DONE)
		expect(existsSync(state.lock)).toBe(false)
	})

	it('leaves an unparseable lock file in place and does not run the work', async () => {
		writeFileSync(state.lock, CORRUPT_RECORD)
		const spy = vi.fn(work)

		const result = await repository_lock.with_lock(spy, state.lock, NO_WAIT_MS)

		expect(result).toBeUndefined()
		expect(spy).not.toHaveBeenCalled()
		expect(readFileSync(state.lock, 'utf8')).toBe(CORRUPT_RECORD)
	})
})

// joshuafolkken/kit#3446: the same lock for a caller that cannot await — the run event stream's append.
describe('repository_lock.with_lock_sync', () => {
	it('runs synchronous work and removes the lock afterwards', () => {
		expect(repository_lock.with_lock_sync(() => DONE, state.lock, NO_WAIT_MS)).toBe(DONE)
		expect(existsSync(state.lock)).toBe(false)
	})

	it('releases the lock when the synchronous work throws', () => {
		expect(() => {
			repository_lock.with_lock_sync(
				() => {
					throw new Error('boom')
				},
				state.lock,
				NO_WAIT_MS,
			)
		}).toThrow('boom')
		expect(existsSync(state.lock)).toBe(false)
	})

	it('does not run the work while a live process holds the lock past the wait', () => {
		writeFileSync(state.lock, live_record())
		const spy = vi.fn(() => DONE)

		expect(repository_lock.with_lock_sync(spy, state.lock, RELEASE_DELAY_MS)).toBeUndefined()
		expect(spy).not.toHaveBeenCalled()
		expect(readFileSync(state.lock, 'utf8')).toBe(live_record())
	})

	it('reclaims the lock of an owner that is gone without waiting', () => {
		writeFileSync(state.lock, JSON.stringify({ pid: DEAD_PID }))

		expect(repository_lock.with_lock_sync(() => DONE, state.lock, NO_WAIT_MS)).toBe(DONE)
	})
})

describe('repository_lock.clear_stale', () => {
	it('removes a record the judge reports as gone', () => {
		writeFileSync(state.lock, live_record())
		repository_lock.clear_stale(state.lock, () => true)

		expect(existsSync(state.lock)).toBe(false)
	})

	it('keeps a record the judge reports as still live', () => {
		writeFileSync(state.lock, JSON.stringify({ pid: DEAD_PID }))
		repository_lock.clear_stale(state.lock, () => false)

		expect(existsSync(state.lock)).toBe(true)
	})

	it('keeps an unparseable record without consulting the judge', () => {
		writeFileSync(state.lock, CORRUPT_RECORD)
		const judge = vi.fn(() => true)

		repository_lock.clear_stale(state.lock, judge)

		expect(judge).not.toHaveBeenCalled()
		expect(readFileSync(state.lock, 'utf8')).toBe(CORRUPT_RECORD)
	})

	it('keeps a fresh claim written after the old record was judged stale', () => {
		writeFileSync(state.lock, JSON.stringify({ pid: DEAD_PID }))
		repository_lock.clear_stale(state.lock, () => {
			writeFileSync(state.lock, live_record())

			return true
		})

		expect(readFileSync(state.lock, 'utf8')).toBe(live_record())
	})

	it('does nothing when there is no record', () => {
		expect(() => {
			repository_lock.clear_stale(state.lock)
		}).not.toThrow()
		expect(existsSync(state.lock)).toBe(false)
	})
})

// joshuafolkken/kit#3503: an unanswered beacon probe cleared a live holder's lock under load.
describe('repository_lock.clear_stale on a holder the default judge cannot place', () => {
	it('keeps the record', () => {
		writeFileSync(state.lock, live_record())
		const probe = vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)

		try {
			repository_lock.clear_stale(state.lock)
		} finally {
			probe.mockRestore()
		}

		expect(readFileSync(state.lock, 'utf8')).toBe(live_record())
	})
})

// joshuafolkken/kit#2986: the record was cast to an owner unchecked, so JSON of another shape reached
// the judge — and the default judge read `.pid` off `null` and threw out of the claim.
describe('repository_lock.clear_stale on a record that is JSON but not an owner', () => {
	it.each([
		['null', 'null'],
		['an array', '[1]'],
		['an object with no pid', '{"process_start":"x"}'],
		['a pid that is not a number', '{"pid":"1"}'],
	])('keeps a record that parses to %s without consulting the judge', (_label, record) => {
		writeFileSync(state.lock, record)
		const judge = vi.fn(() => true)

		repository_lock.clear_stale(state.lock, judge)

		expect(judge).not.toHaveBeenCalled()
		expect(readFileSync(state.lock, 'utf8')).toBe(record)
	})

	it('does not throw on a record that parses to null under the default judge', () => {
		writeFileSync(state.lock, 'null')

		expect(() => {
			repository_lock.clear_stale(state.lock)
		}).not.toThrow()
	})
})

describe('repository_lock.lock_path', () => {
	// A pre-push hook exports `GIT_DIR`, which would resolve every directory to the gated checkout.
	// The returned restore runs as the block's teardown.
	beforeAll(() => git_location_environment.clear_git_location_variables())

	it('keys a directory outside any repository on the directory itself', () => {
		expect(repository_lock.lock_path(PREFIX, state.scratch)).toBe(
			stamp_file.stamp_path(PREFIX, state.scratch),
		)
	})

	it('answers one path for two directories of the same repository', () => {
		const root = process.cwd()

		expect(repository_lock.lock_path(PREFIX, path.join(root, 'scripts'))).toBe(
			repository_lock.lock_path(PREFIX, root),
		)
	})

	it('answers a different path for a different lock name', () => {
		expect(repository_lock.lock_path(PREFIX, state.scratch)).not.toBe(
			repository_lock.lock_path(OTHER_PREFIX, state.scratch),
		)
	})
})
