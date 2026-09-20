import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classify_isolation } from './classify-isolation'
import { PILOT_FILES } from './pilot-files'
import { VITEST_INCLUDE_GLOBS } from './vitest-include-globs'

function glob_to_matcher(glob: string): (file: string) => boolean {
	if (!glob.includes('/')) {
		const suffix = glob.replace(/^\*+/u, '')

		return (file) => !file.includes('/') && file.endsWith(suffix)
	}

	const directory = glob.slice(0, glob.indexOf('/'))

	return (file) => file.startsWith(`${directory}/`)
}

function matches_main_include(file: string): boolean {
	return VITEST_INCLUDE_GLOBS.some((glob) => glob_to_matcher(glob)(file))
}

describe('matches_main_include — root-glob branch', () => {
	it('accepts a root-level .test.ts file', () => {
		expect(matches_main_include('root.test.ts')).toBe(true)
	})

	it('rejects a root-level file not ending in .test.ts', () => {
		expect(matches_main_include('root.helper.ts')).toBe(false)
	})

	it('rejects a file whose path has a directory component (directory globs cover those)', () => {
		expect(matches_main_include('unknown/foo.test.ts')).toBe(false)
	})
})

describe('PILOT_FILES — partitioning does not lose test targets', () => {
	it('is non-empty', () => {
		expect(PILOT_FILES.length).toBeGreaterThan(0)
	})

	it('contains no duplicate entries', () => {
		expect(new Set(PILOT_FILES).size).toBe(PILOT_FILES.length)
	})

	it('all files exist on disk', () => {
		for (const file of PILOT_FILES) {
			expect(existsSync(file), `${file} does not exist on disk`).toBe(true)
		}
	})

	it('all files are covered by a main-suite include pattern', () => {
		for (const file of PILOT_FILES) {
			expect(matches_main_include(file), `${file} is not covered by vitest.config.ts`).toBe(true)
		}
	})
})

describe('PILOT_FILES — the list is a generated artifact, not a hand-kept one', () => {
	it('matches the classifier output exactly (regenerate on drift)', () => {
		const regenerate = 'pnpm exec tsx scripts/test/classify-isolation.ts --write'

		expect([...PILOT_FILES], `stale — run: ${regenerate}`).toEqual(
			classify_isolation.classify_pilot_files(),
		)
	})

	it('holds no file that requires isolation (misclassification guard)', () => {
		for (const file of PILOT_FILES) {
			expect(classify_isolation.is_pilot_candidate(file), `${file} requires isolation`).toBe(true)
		}
	})
})
