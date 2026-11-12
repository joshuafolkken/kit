import { randomUUID } from 'node:crypto'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { vi } from 'vitest'
import { shared_cache, type CacheSlot } from './shared-cache'
import { stamp_file } from './stamp-file'

// Keys `slots` to a repository root of the test's own, so a suite never reads, writes or clears the
// machine-wide record a concurrent lane's run of the same suite keeps (joshuafolkken/kit#4550).
// Returns the teardown that removes the test's records — return it from `beforeEach`. It removes the
// paths it was given, so it holds whether or not the spy has been restored first. Every slot a test
// reaches is named in one call: a second call moves the root, leaving the first call's record behind.
function isolate_shared_cache(...slots: ReadonlyArray<CacheSlot>): () => void {
	const root = `/shared-cache-test/${randomUUID()}`

	vi.spyOn(git_common_directory, 'repository').mockReturnValue(root)

	return function remove_records(): void {
		for (const slot of slots) stamp_file.remove_stamp(stamp_file.stamp_path(slot.prefix, root))
	}
}

// Keeps every slot's record in this test's memory rather than on disk, for a suite whose reads walk
// more slots than one `isolate_shared_cache` teardown removes — the per-path ETag records
// (joshuafolkken/kit#6560). The TTL is not applied: a test reads its own records back at once.
function keep_in_memory(): void {
	const records = new Map<string, unknown>()

	vi.spyOn(shared_cache, 'write').mockImplementation((slot, key, value) => {
		records.set(`${slot.prefix}${key}`, value)
	})
	vi.spyOn(shared_cache, 'read').mockImplementation((slot, key, schema) => {
		const parsed = schema.safeParse(records.get(`${slot.prefix}${key}`))

		return parsed.success ? parsed.data : undefined
	})
}

const shared_cache_fixture = { isolate_shared_cache, keep_in_memory }

export { shared_cache_fixture }
