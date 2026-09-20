import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Vitest 5 removed `poolOptions.forks.isolate`; the option is now top-level. Setting it the old way
// is accepted silently and ignored, so the pilot spawns one worker per file and saves nothing
// (joshuafolkken/kit#2170). These guard the fix against a future config regression. The path is
// resolved from the working directory, which is the repository root under both vitest configs.
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
