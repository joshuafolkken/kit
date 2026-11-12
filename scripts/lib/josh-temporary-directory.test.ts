import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { describe, expect, it } from 'vitest'
import { JOSH_TMP_DIRECTORY } from './josh-temporary-directory'

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const IGNORED_EXIT_CODE = 0

// The constant is only worth naming because git ignores the place it names — a writer defaulting to
// it, and the body reader sending callers to it, both rely on nothing written there being committed.
describe('JOSH_TMP_DIRECTORY', () => {
	it('names a directory the checkout ignores', () => {
		const result = git_spawn_sync.run(
			['check-ignore', '-q', '--no-index', `${JOSH_TMP_DIRECTORY}/probe.md`],
			{ cwd: REPOSITORY_ROOT, env: git_location_environment.location_free_environment() },
		)

		expect(result.exit_code).toBe(IGNORED_EXIT_CODE)
	})
})
