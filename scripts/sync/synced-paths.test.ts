import { read_repo_file } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { EXCLUDED_SYNC_TARGETS, synced_paths } from './synced-paths'

// The enumeration in `synced-paths.ts` is what the managed config-file gate matches against, and a
// hand-copied list drifts the moment `sync.ts` grows a destination. So the list is not trusted: this
// suite reads `sync.ts` itself and fails when it writes somewhere the list does not name
// (joshuafolkken/kit#1578).

const SYNC_SOURCE = 'scripts/sync/sync.ts'
const PACKAGE_JSON = 'package.json'

// Every `path.join(PROJECT_ROOT, '<literal>')` in `sync.ts` — the one shape a consumer destination is
// written in there. A destination reached through a constant instead (`PACKAGE_JSON`) is not matched,
// which is why the excluded set is asserted separately below rather than being inferred from a miss.
const DESTINATION_PATTERN = /path\.join\(PROJECT_ROOT,\s*'([^']+)'\)/gu

function read_sync_destinations(): Array<string> {
	const source = read_repo_file(SYNC_SOURCE)

	// `Array.from` with a mapper rather than the iterator helper `.toArray()`: this project's
	// `tsconfig.json` does not carry the iterator-helper lib, so the chained form types as `error`.
	return Array.from(source.matchAll(DESTINATION_PATTERN), (match) => match[1] ?? '')
}

describe('synced-paths stays in step with sync.ts', () => {
	it('finds destinations to check at all', () => {
		expect(read_sync_destinations().length).toBeGreaterThan(0)
	})

	it('names every consumer destination sync.ts writes', () => {
		const listed = new Set([...synced_paths.get_synced_paths(), ...EXCLUDED_SYNC_TARGETS])
		const unlisted = read_sync_destinations().filter((destination) => !listed.has(destination))

		expect(unlisted).toEqual([])
	})
})

describe('synced_paths.get_synced_paths', () => {
	// The file the prose this gate replaced used as its worked example, and the reason the three
	// `AI_COPY_*` lists alone were not enough.
	it('includes playwright.config.ts', () => {
		expect(synced_paths.get_synced_paths()).toContain('playwright.config.ts')
	})

	it('includes the Sonar destination, read from init-logic rather than repeated', () => {
		expect(synced_paths.get_synced_paths()).toContain('sonar-project.properties')
	})

	// `sync` realigns one field of it rather than overwriting it, so listing it would fire the gate on
	// every dependency change in every repository.
	it('leaves package.json out, deliberately', () => {
		expect(synced_paths.get_synced_paths()).not.toContain(PACKAGE_JSON)
		expect(EXCLUDED_SYNC_TARGETS).toContain(PACKAGE_JSON)
	})
})
