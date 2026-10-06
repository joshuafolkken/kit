import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { unit_projects } from './unit-projects'

// Vitest 5 removed `poolOptions.forks.isolate`; the option is now top-level. Setting it the old way
// is accepted silently and ignored, so the pure project would start one worker per file and save
// nothing (joshuafolkken/kit#2170). The paths are resolved from the working directory, which is the
// repository root under every vitest config.
const UNIT_PROJECTS_PATH = 'scripts/test/unit-projects.ts'
const MAIN_CONFIG = 'vitest.config.ts'
const HARNESS_CONFIG = 'vitest.harness.config.ts'
const ROOT_CONFIGS: ReadonlyArray<string> = [MAIN_CONFIG, HARNESS_CONFIG]

describe('unit projects — isolate has to take effect', () => {
	it('does not nest the option under the removed poolOptions key', () => {
		expect(readFileSync(UNIT_PROJECTS_PATH, 'utf8')).not.toMatch(/poolOptions\s*:/u)
	})
})

// Vite 8.3 warns that its planned `configLoader: 'native'` default cannot resolve a relative import
// left without a file extension — the deprecation surfaced by the joshuafolkken/kit#2200 vite bump.
// A config that emits a warning makes the gate withhold its green reuse stamp, so a dropped extension
// here also blinds `josh run:review --join`. These pin the explicit `.ts` on the local helper imports.
// The loader follows the config's import graph, so `unit-projects.ts` is held to the same rule; it
// reaches its siblings through `#scripts/*`, which Node resolves and TypeScript accepts.
describe('vitest configs — native config loader resolves local imports', () => {
	it.each([...ROOT_CONFIGS, UNIT_PROJECTS_PATH])(
		'leaves no extensionless relative import in %s',
		(config_path) => {
			const source = readFileSync(config_path, 'utf8')
			const extensionless_local_import = /from '\.\/[^']*(?<!\.ts)'/u

			expect(source).not.toMatch(extensionless_local_import)
		},
	)
})

// joshuafolkken/kit#3253: the harness config armed none of the guards the main config arms, so its
// slow suites could reach GitHub, leak to stdout or send a real Telegram message unnoticed. Both
// configs read the one guard list `unit-projects.ts` defines; loaded here as Vitest loads them.
const PATHS = z.array(z.string())
const GUARDS = z.object({ globalSetup: PATHS, setupFiles: PATHS.optional() })
const GUARDED_CONFIG = z.object({ default: z.object({ test: GUARDS }) })

type GuardedConfig = z.infer<typeof GUARDED_CONFIG>['default']

async function load_config(config_path: string): Promise<GuardedConfig> {
	const loaded: unknown = await import(pathToFileURL(path.resolve(config_path)).href)

	return GUARDED_CONFIG.parse(loaded).default
}

describe('vitest configs — every config arms the same guards', () => {
	it('arms the network guard in the main config', async () => {
		const config = await load_config(MAIN_CONFIG)

		expect(config.test.globalSetup).toEqual(unit_projects.NETWORK_GUARD)
	})

	it('arms the network guard and the worker guards in the harness config', async () => {
		const config = await load_config(HARNESS_CONFIG)

		expect(config.test.globalSetup).toEqual(unit_projects.NETWORK_GUARD)
		expect(config.test.setupFiles).toEqual(unit_projects.WORKER_GUARDS)
	})

	it.each(unit_projects.UNIT_PROJECTS.map((project) => project.test.name))(
		'arms the worker guards in the %s project',
		(name) => {
			const project = unit_projects.UNIT_PROJECTS.find((one) => one.test.name === name)

			expect(project?.test.setupFiles).toEqual(unit_projects.WORKER_GUARDS)
		},
	)
})
