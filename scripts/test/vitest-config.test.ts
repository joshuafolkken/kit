import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { unit_projects } from '#tools/test/unit-projects'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Vitest 5 removed `poolOptions.forks.isolate`; the option is now top-level. Setting it the old way
// is accepted silently and ignored, so the pure project would start one worker per file and save
// nothing (joshuafolkken/kit#2170). The paths are resolved from the working directory, which is the
// repository root under every vitest config.
const UNIT_PROJECTS_PATH = 'tools/test/unit-projects.ts'
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
// here also blinds `josh run:review --join`. The loader follows the config's whole import graph, so
// every file it reaches is held to the rule, not only the configs' direct helpers: the worker-share
// helper (joshuafolkken/kit#4262) pulled in `stamp-file.ts`, whose `./platform-temporary` warned.
// `#scripts/*` and `#tools/*` resolve through `package.json` imports, which Node and TypeScript accept.
const LOCAL_SPECIFIER = /(?:from|import)\s+'((?:\.{1,2}\/|#scripts\/|#tools\/)[^']*)'/gu
const SUBPATH_ROOTS: ReadonlyArray<readonly [string, string]> = [
	['#scripts/', 'scripts/'],
	['#tools/', 'tools/'],
]

function resolve_local(importer: string, specifier: string): string {
	const subpath = SUBPATH_ROOTS.find(([prefix]) => specifier.startsWith(prefix))

	if (subpath !== undefined) return `${subpath[1]}${specifier.slice(subpath[0].length)}.ts`

	const target = path.join(path.dirname(importer), specifier)

	return target.endsWith('.ts') ? target : `${target}.ts`
}

function local_specifiers(file: string): Array<string> {
	return [...readFileSync(file, 'utf8').matchAll(LOCAL_SPECIFIER)].map((match) => match[1] ?? '')
}

function visit(file: string, seen: Set<string>): void {
	if (seen.has(file)) return

	seen.add(file)
	for (const specifier of local_specifiers(file)) visit(resolve_local(file, specifier), seen)
}

function is_extensionless_relative(specifier: string): boolean {
	return specifier.startsWith('.') && !specifier.endsWith('.ts')
}

// Every extensionless relative import reachable from `entries`, as `importer → specifier`.
function extensionless_imports(entries: ReadonlyArray<string>): Array<string> {
	const seen = new Set<string>()

	for (const entry of entries) visit(entry, seen)

	return [...seen].flatMap((file) =>
		local_specifiers(file)
			.filter((specifier) => is_extensionless_relative(specifier))
			.map((specifier) => `${file} → ${specifier}`),
	)
}

describe('vitest configs — native config loader resolves local imports', () => {
	it('leaves no extensionless relative import anywhere in the configs import graph', () => {
		expect(extensionless_imports(ROOT_CONFIGS)).toEqual([])
	})
})

// joshuafolkken/kit#3253: the harness config armed none of the guards the main config arms, so its
// slow suites could reach GitHub, leak to stdout or send a real Telegram message unnoticed. Both
// configs read the one guard list `unit-projects.ts` defines; loaded here as Vitest loads them.
const PATHS = z.array(z.string())
const GUARDS = z.object({ globalSetup: PATHS, setupFiles: PATHS.optional() })
const GUARDED_CONFIG = z.object({ default: z.object({ test: GUARDS }) })
const OPTIMIZED_TEST = z.object({ deps: z.unknown() }).loose()
const OPTIMIZED_CONFIG = z.object({ default: z.object({ test: OPTIMIZED_TEST }) })

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

	// joshuafolkken/kit#4262: without the key a direct `pnpm vitest` — either config — ignores the share
	// entirely. Its value
	// is `vitest_config_workers.config_workers`'s, pinned in that module's own suite.
	it.each(ROOT_CONFIGS)('sizes the workers in %s', async (config_path) => {
		const loaded: unknown = await import(pathToFileURL(path.resolve(config_path)).href)
		const sized = z.object({ default: z.object({ test: z.object({}).loose() }) }).parse(loaded)

		expect(Object.hasOwn(sized.default.test, 'maxWorkers')).toBe(true)
	})

	// joshuafolkken/kit#4301: on the root, not per project, so both projects share its Vite server.
	it('sets the dependency optimizer on the main config root', async () => {
		const loaded: unknown = await import(pathToFileURL(path.resolve(MAIN_CONFIG)).href)
		const optimized = OPTIMIZED_CONFIG.parse(loaded)

		expect(optimized.default.test.deps).toEqual(unit_projects.DEPENDENCY_OPTIMIZER)
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

			expect(project?.test.setupFiles).toEqual([
				...unit_projects.WORKER_GUARDS,
				...unit_projects.READ_RECORDER,
			])
		},
	)
})

// joshuafolkken/kit#4465: by path, so the reporter and the ledger it writes stay out of the config's
// dependencies, whose change runs every test under `vitest related`.
const REPORTED_TEST = z.object({ reporters: z.array(z.unknown()) })
const REPORTED_CONFIG = z.object({ default: z.object({ test: REPORTED_TEST }) })
const REPORTER_ENTRY = z.object({ default: z.function() })

async function import_module(module_path: string): Promise<unknown> {
	const loaded: unknown = await import(pathToFileURL(path.resolve(module_path)).href)

	return loaded
}

describe('vitest configs — the unit file reporter is named, not imported', () => {
	it('names the unit file reporter by its path in the main config', async () => {
		const config = REPORTED_CONFIG.parse(await import_module(MAIN_CONFIG))
		const named = ['default', unit_projects.UNIT_FILE_REPORTER]

		// The leading entries only: a `JOSH_UNIT_DURATIONS=record` run appends the duration reporter.
		expect(config.default.test.reporters.slice(0, named.length)).toEqual(named)
	})

	it('loads a reporter vitest can construct from the named path', async () => {
		const entry = REPORTER_ENTRY.parse(await import_module(unit_projects.UNIT_FILE_REPORTER))

		expect(Reflect.construct(entry.default, [])).toHaveProperty('onTestRunEnd')
	})
})
