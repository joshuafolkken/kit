import { defineConfig } from 'vitest/config'

const TEST_TIMEOUT_MS = 10_000

export default defineConfig({
	test: {
		include: [
			'*.test.ts',
			'scripts/**/*.test.ts',
			'scripts-ai/**/*.test.ts',
			'env/**/*.test.ts',
			'eslint/**/*.test.ts',
			'ports/**/*.test.ts',
			'prettier/**/*.test.ts',
			'templates/**/*.test.ts',
		],
		testTimeout: TEST_TIMEOUT_MS,
		// A unit test that reaches GitHub fails on someone else's latency rather than on the code under
		// test. The guard puts a recording `gh` in front of the real one and fails the run if anything
		// spawned it (joshuafolkken/kit#1353).
		globalSetup: ['./scripts/test-network-guard.ts'],
		coverage: {
			provider: 'v8',
		},
	},
})
