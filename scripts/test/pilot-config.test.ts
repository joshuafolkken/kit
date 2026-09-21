import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Vitest 5 removed `poolOptions.forks.isolate`; the option is now top-level. Setting it the old way
// is accepted silently and ignored, so the pilot spawns one worker per file and saves nothing
// (joshuafolkken/kit#2170). These guard the fix against a future config regression. The path is
// resolved from the working directory, which is the repository root under both vitest configs.
const MAIN_CONFIG_PATH = 'vitest.config.ts'
const CONFIG_PATH = 'vitest.pilot.config.ts'

describe('vitest.pilot.config — isolate:false has to take effect', () => {
	const source = readFileSync(CONFIG_PATH, 'utf8')

	it('sets isolate:false as a top-level test option', () => {
		expect(source).toMatch(/\n\t\tisolate: false,/u)
	})

	it('does not nest the option under the removed poolOptions key', () => {
		expect(source).not.toMatch(/poolOptions\s*:/u)
	})
})

// Vite 8.3 warns that its planned `configLoader: 'native'` default cannot resolve a relative import
// left without a file extension — the deprecation surfaced by the joshuafolkken/kit#2200 vite bump.
// A config that emits a warning makes the gate withhold its green reuse stamp, so a dropped extension
// here also blinds `josh run:review --join`. These pin the explicit `.ts` on the local helper imports.
describe('vitest configs — native config loader resolves local imports', () => {
	const ROOT_CONFIGS = [MAIN_CONFIG_PATH, CONFIG_PATH]

	it.each(ROOT_CONFIGS)(
		'gives %s local helper imports an explicit .ts extension',
		(config_path) => {
			const source = readFileSync(config_path, 'utf8')
			const extensionless_local_import = /from '\.\/[^']*(?<!\.ts)'/u

			expect(source).not.toMatch(extensionless_local_import)
		},
	)
})
