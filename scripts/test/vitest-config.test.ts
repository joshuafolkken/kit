import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Vitest 5 removed `poolOptions.forks.isolate`; the option is now top-level. Setting it the old way
// is accepted silently and ignored, so the pure project would start one worker per file and save
// nothing (joshuafolkken/kit#2170). The paths are resolved from the working directory, which is the
// repository root under every vitest config.
const UNIT_PROJECTS_PATH = 'scripts/test/unit-projects.ts'
const ROOT_CONFIGS: ReadonlyArray<string> = ['vitest.config.ts', 'vitest.harness.config.ts']

describe('unit projects — isolate has to take effect', () => {
	it('does not nest the option under the removed poolOptions key', () => {
		expect(readFileSync(UNIT_PROJECTS_PATH, 'utf8')).not.toMatch(/poolOptions\s*:/u)
	})
})

// Vite 8.3 warns that its planned `configLoader: 'native'` default cannot resolve a relative import
// left without a file extension — the deprecation surfaced by the joshuafolkken/kit#2200 vite bump.
// A config that emits a warning makes the gate withhold its green reuse stamp, so a dropped extension
// here also blinds `josh run:review --join`. These pin the explicit `.ts` on the local helper imports.
describe('vitest configs — native config loader resolves local imports', () => {
	it.each(ROOT_CONFIGS)(
		'gives %s local helper imports an explicit .ts extension',
		(config_path) => {
			const source = readFileSync(config_path, 'utf8')
			const extensionless_local_import = /from '\.\/[^']*(?<!\.ts)'/u

			expect(source).not.toMatch(extensionless_local_import)
		},
	)
})
