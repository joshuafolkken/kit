import { vitest_config_workers } from '#tools/test/vitest-config-workers'
import { defineConfig } from 'vitest/config'
import { unit_projects } from './tools/test/unit-projects.ts'

// The integration harness's slow suites — exactly the files `MAIN_EXCLUDE` keeps out of the unit
// gate (joshuafolkken/kit#2447). Named on the command line under the main config, such a file is
// filtered out by every project's own exclude and the run passes having run nothing, so they run
// under a config of their own: pnpm vitest run --config vitest.harness.config.ts
// Above the slowest single josh command these suites allow (15 s), so a slow command fails on its own
// timeout assertion rather than on vitest's generic one.
const TEST_TIMEOUT_MS = 30_000

export default defineConfig({
	test: {
		env: unit_projects.ENV,
		testTimeout: TEST_TIMEOUT_MS,
		include: [...unit_projects.MAIN_EXCLUDE],
		globalSetup: [...unit_projects.NETWORK_GUARD],
		setupFiles: [...unit_projects.WORKER_GUARDS],
		// The direct run above takes the same share of the machine as the main config's.
		maxWorkers: vitest_config_workers.config_workers(),
	},
})
