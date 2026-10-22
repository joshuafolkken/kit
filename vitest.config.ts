import { vitest_config_workers } from '#tools/test/vitest-config-workers'
import { defineConfig } from 'vitest/config'
import { unit_projects } from './tools/test/unit-projects.ts'

// The unit suite runs as two projects — `pure` (isolate:false) and `isolated` (default per-file
// isolation) — defined and partitioned in `tools/test/unit-projects.ts`. `globalSetup` and
// `coverage` stay at the root because Vitest reads them once for the whole run rather than per
// project; `include`, `exclude`, `isolate` and `env` are each project's own.
export default defineConfig({
	test: {
		// A unit test that reaches GitHub fails on someone else's latency rather than on the code under
		// test. The network guard puts a recording `gh` in front of the real one and fails the run if
		// anything spawned it (joshuafolkken/kit#1353); armed once here, it fronts `PATH` before any
		// worker of either project forks, so both inherit it. The pure project adds the state guard of
		// its own, since isolate:false is the only run a leaked branch or dirty tree can reach a sibling
		// in.
		globalSetup: [...unit_projects.NETWORK_GUARD],
		// A direct `pnpm vitest` takes the same share of the machine as `josh test:*` beside other lanes;
		// `undefined` — alone, or driven by `josh`, whose guard sizes the run itself — leaves the choice
		// to the command line or vitest's default (joshuafolkken/kit#4262).
		maxWorkers: vitest_config_workers.config_workers(),
		// The default output, plus the run's slowest files in the lane ledger (joshuafolkken/kit#4451).
		// **Named by path, never imported**: everything this file imports is a config dependency, and
		// `vitest related` runs every test on a change to one (joshuafolkken/kit#4465).
		reporters: ['default', unit_projects.UNIT_FILE_REPORTER],
		// Root-level so both projects keep sharing this config's Vite server (joshuafolkken/kit#4301).
		deps: unit_projects.DEPENDENCY_OPTIMIZER,
		coverage: {
			provider: 'v8',
		},
		projects: [...unit_projects.UNIT_PROJECTS],
	},
})
