import { defineConfig } from 'vitest/config'
import { unit_projects } from './scripts/test/unit-projects.ts'

// The unit suite runs as two projects — `pure` (isolate:false) and `isolated` (default per-file
// isolation) — defined and partitioned in `scripts/test/unit-projects.ts`. `globalSetup` and
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
		globalSetup: ['./scripts/test/test-network-guard.ts'],
		coverage: {
			provider: 'v8',
		},
		projects: [...unit_projects.UNIT_PROJECTS],
	},
})
