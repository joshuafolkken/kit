import { defineConfig } from 'vitest/config'

const TEST_TIMEOUT_MS = 10_000

export default defineConfig({
	test: {
		include: [
			'*.test.ts',
			'scripts/**/*.test.ts',
			'scripts-ai/**/*.test.ts',
			'eslint/**/*.test.ts',
			'prettier/**/*.test.ts',
			'templates/**/*.test.ts',
		],
		testTimeout: TEST_TIMEOUT_MS,
		coverage: {
			provider: 'v8',
		},
	},
})
