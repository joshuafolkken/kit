import { defineConfig } from 'vitest/config'

const TEST_TIMEOUT_MS = 10_000

export default defineConfig({
	test: {
		include: [
			'scripts/**/*.test.ts',
			'scripts-ai/**/*.test.ts',
			'eslint/**/*.test.ts',
			'templates/**/*.test.ts',
		],
		testTimeout: TEST_TIMEOUT_MS,
		coverage: {
			provider: 'v8',
		},
	},
})
