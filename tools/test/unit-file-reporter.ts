import path from 'node:path'
import type { Reporter, TestModule } from 'vitest/node'

// Each unit run's slowest test files, written to the lane ledger once the run ends
// (joshuafolkken/kit#4451). A unit leg whose wall time far outran its CPU — 1032 s against 658 s on
// 2026-10-21 — left no record of the file it stalled on; this one names it afterwards.
//
// **Its own ledger path, not `lane_ledger.target`'s**, which answers none under `VITEST` so a suite
// cannot append fixture durations. This reporter runs in vitest's own process, where that is always
// set, and what it records is the run itself.

// Enough to name a stalled file beside the few that are always slow, few enough for a short line.
const SLOWEST_COUNT = 5

// `lane_ledger`'s `UnitFileRecord` by shape: even a type import would bring the ledger into the config's
// import graph, and `record_unit_files` still checks this against its own schema type.
interface UnitFileRecord {
	file: string
	elapsed_ms: number
}

type UnitFilesSink = (files: ReadonlyArray<UnitFileRecord>) => Promise<void>

// The part of vitest's `TestModule` this reads, so a test hands it a plain object.
interface TimedModule {
	moduleId: string
	diagnostic: () => Pick<
		ReturnType<TestModule['diagnostic']>,
		| 'environmentSetupDuration'
		| 'prepareDuration'
		| 'collectDuration'
		| 'setupDuration'
		| 'duration'
	>
}

// From the file's environment setup to its last test: a stall in an import shows as well as one in a test.
function elapsed_of(module: TimedModule): number {
	const diagnostic = module.diagnostic()

	return Math.round(
		diagnostic.environmentSetupDuration +
			diagnostic.prepareDuration +
			diagnostic.collectDuration +
			diagnostic.setupDuration +
			diagnostic.duration,
	)
}

function slowest_files(
	modules: ReadonlyArray<TimedModule>,
	root: string = process.cwd(),
): Array<UnitFileRecord> {
	return modules
		.map((module) => ({
			file: path.relative(root, module.moduleId),
			elapsed_ms: elapsed_of(module),
		}))
		.toSorted((left, right) => right.elapsed_ms - left.elapsed_ms)
		.slice(0, SLOWEST_COUNT)
}

// Best-effort, as every ledger writer is: outside a repository there is no ledger, and a failed read
// or append is dropped rather than failing the run it measures. The ledger and git helpers load at the
// run end, not with `vitest.config.ts`: their extensionless relative imports would otherwise enter the
// config's import graph, which Vite's native config loader cannot resolve (`vitest-config.test.ts`).
// That also keeps a failed import inside the `try`.
async function record_to_ledger(files: ReadonlyArray<UnitFileRecord>): Promise<void> {
	try {
		const [{ lane_ledger }, { run_carry }] = await Promise.all([
			import('#scripts/lane/lane-ledger'),
			import('#scripts/run/carry/run-carry'),
		])
		const repository = await run_carry.repository_directory()

		if (repository === undefined) return

		await lane_ledger.record_unit_files(files, lane_ledger.target_of(repository))
	} catch {
		// Reporting is best-effort: no repository, or no git, records nothing.
	}
}

// A run that ran no file — a filter that matched nothing — has nothing to name.
async function report(
	modules: ReadonlyArray<TimedModule>,
	sink: UnitFilesSink = record_to_ledger,
): Promise<void> {
	if (modules.length === 0) return

	await sink(slowest_files(modules))
}

function create(): Reporter {
	return {
		async onTestRunEnd(modules: ReadonlyArray<TestModule>): Promise<void> {
			await report(modules)
		},
	}
}

const unit_file_reporter = { SLOWEST_COUNT, create, record_to_ledger, report, slowest_files }

export type { TimedModule }
export { unit_file_reporter }
