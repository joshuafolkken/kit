import { randomUUID } from 'node:crypto'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { vi } from 'vitest'
import type { CacheSlot } from './shared-cache'
import { stamp_file } from './stamp-file'

// Keys `slot` to a repository root of the test's own, so a suite never reads, writes or clears the
// machine-wide record a concurrent lane's run of the same suite keeps (joshuafolkken/kit#4550).
// Returns the teardown that removes the test's record — return it from `beforeEach`. It removes the
// path it was given, so it holds whether or not the spy has been restored first.
function isolate_shared_cache(slot: CacheSlot): () => void {
	const root = `/shared-cache-test/${randomUUID()}`

	vi.spyOn(git_common_directory, 'repository').mockReturnValue(root)

	return function remove_record(): void {
		stamp_file.remove_stamp(stamp_file.stamp_path(slot.prefix, root))
	}
}

const shared_cache_fixture = { isolate_shared_cache }

export { shared_cache_fixture }
