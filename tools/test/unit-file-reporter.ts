import path from 'node:path'
import { unit_count_file } from '#scripts/test/unit-count-file'
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

// `lane_ledger`'s `UnitFileRecord` by shape, so this module loads nothing of the ledger until the run
// ends; `record_unit_files` still checks this against its own schema type.
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
// run end, which keeps a failed import inside the `try`. `vitest.config.ts` names this reporter by path
// and never imports it, so none of this enters the config's import graph (joshuafolkken/kit#4465).
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

// The count target is read once, in vitest's own process, so a test file the run starts cannot
// overwrite it (joshuafolkken/kit#4465).
function create(): Reporter {
	const count_target = process.env[unit_count_file.COUNT_FILE_ENVIRONMENT]

	return {
		async onTestRunEnd(modules: ReadonlyArray<TestModule>): Promise<void> {
			await Promise.all([
				report(modules),
				unit_count_file.write_count(modules.length, count_target),
			])
		},
	}
}

const unit_file_reporter = {
	SLOWEST_COUNT,
	create,
	record_to_ledger,
	report,
	slowest_files,
}

export type { TimedModule }
export { unit_file_reporter }
