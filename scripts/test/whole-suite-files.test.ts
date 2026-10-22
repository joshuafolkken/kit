import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { unit_setup_files } from './unit-setup-files'
import { whole_suite_files } from './whole-suite-files'

// joshuafolkken/kit#4465: `vitest related` runs every test when a file it is given is one the config
// imports — static or dynamic, as Vite's bundling config loader follows both — or one a worker's setup
// files import. Each such file has to be one `josh test:related` names, so the widening prints its
// reason. The network guard is left out: it is global setup, whose imports narrow as any module does.
const MAIN_CONFIG = 'vitest.config.ts'
const WORKER_SETUP: ReadonlyArray<string> = [
	...unit_setup_files.STATE_GUARD,
	...unit_setup_files.WORKER_GUARDS,
	...unit_setup_files.READ_RECORDER,
]

async function import_graph(entries: ReadonlyArray<string>): Promise<Array<string>> {
	const result = await build({
		entryPoints: [...entries],
		bundle: true,
		write: false,
		outdir: 'unused',
		platform: 'node',
		format: 'esm',
		packages: 'external',
		metafile: true,
		logLevel: 'silent',
	})

	return Object.keys(result.metafile.inputs).map((file) => path.normalize(file))
}

function unnamed(files: ReadonlyArray<string>): Array<string> {
	return files.filter((file) => !whole_suite_files.WHOLE_SUITE_FILES.has(file))
}

describe('whole_suite_files — every file vitest widens the whole suite on', () => {
	it('names every module the main vitest config imports', async () => {
		expect(unnamed(await import_graph([MAIN_CONFIG]))).toEqual([])
	})

	it('names every module a worker setup file imports', async () => {
		expect(unnamed(await import_graph(WORKER_SETUP))).toEqual([])
	})

	it('keeps the unit file reporter and the ledger out of the config imports', async () => {
		const graph = await import_graph([MAIN_CONFIG])

		expect(graph).not.toContain(path.normalize('tools/test/unit-file-reporter.ts'))
		expect(graph).not.toContain(path.normalize('scripts/lane/lane-ledger.ts'))
	})

	it('names the network guard itself', () => {
		expect(whole_suite_files.WHOLE_SUITE_FILES).toContain(
			path.normalize(String(unit_setup_files.NETWORK_GUARD[0])),
		)
	})
})
