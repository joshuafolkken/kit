import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { afterAll, afterEach } from 'vitest'

type TemporaryLifetime = 'test' | 'suite'
type CreateTemporaryDirectory = (prefix: string) => string

// Register during suite collection; call the returned creator from tests or setup hooks.
// Suite lifetime keeps roots created during collection or beforeAll alive between tests.
function temporary_directory(lifetime: TemporaryLifetime = 'test'): CreateTemporaryDirectory {
	const directories: Array<string> = []
	const register_cleanup = lifetime === 'test' ? afterEach : afterAll

	register_cleanup(function cleanup(): void {
		for (const directory of directories.splice(0).toReversed()) {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	return function create(prefix: string): string {
		const directory = mkdtempSync(path.resolve(PLATFORM_TEMP_ROOT, prefix))

		directories.push(directory)

		return directory
	}
}

export { temporary_directory }
