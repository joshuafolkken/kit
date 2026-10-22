import type { TestModule } from 'vitest/node'

// One test file's wall time, read by the slowest-files reporter and the duration record alike. A
// module of its own that imports nothing at run time: the duration record is in `vitest.config.ts`'s
// import graph through the sequencer, and taking this from the reporter would bring the reporter and
// its ledger back into the config's dependencies, on whose change `vitest related` runs every test
// (joshuafolkken/kit#4465).

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

const test_module_elapsed = { elapsed_of }

export type { TimedModule }
export { test_module_elapsed }
