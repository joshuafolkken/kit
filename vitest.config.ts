import { defineConfig } from 'vitest/config'
import { VITEST_INCLUDE_GLOBS } from './scripts/test/vitest-include-globs.ts'

const TEST_TIMEOUT_MS = 10_000

export default defineConfig({
	test: {
		env: {
			CLAUDE_CODE_SESSION_ID: 'vitest-session',
			CODEX_THREAD_ID: '',
		},
		include: [...VITEST_INCLUDE_GLOBS],
		// Smoke test packs and installs the real tarball — too slow (~60 s setup) for the unit
		// gate. Run before release with: pnpm vitest run scripts/build/packed-consumer.test.ts
		exclude: ['scripts/build/packed-consumer.test.ts'],
		testTimeout: TEST_TIMEOUT_MS,
		// A unit test that reaches GitHub fails on someone else's latency rather than on the code under
		// test. The guard puts a recording `gh` in front of the real one and fails the run if anything
		// spawned it (joshuafolkken/kit#1353).
		// vitest.pilot.config.ts runs a subset of pure tests with isolate:false for performance
		// measurement. See scripts/test/pilot-files.ts for the isolation-requirement definition.
		globalSetup: ['./scripts/test/test-network-guard.ts'],
		coverage: {
			provider: 'v8',
		},
	},
})
