import { defineConfig } from 'vitest/config'
import { PILOT_FILES } from './scripts/test/pilot-files.ts'

const TEST_TIMEOUT_MS = 10_000

export default defineConfig({
	test: {
		env: {
			CLAUDE_CODE_SESSION_ID: 'vitest-session',
			CODEX_THREAD_ID: '',
		},
		include: [...PILOT_FILES],
		// Vitest 5 removed `poolOptions.forks.isolate` in favor of this top-level option; setting it
		// the old way is silently ignored, so every file still spawns its own worker (joshuafolkken/kit#2170).
		isolate: false,
		testTimeout: TEST_TIMEOUT_MS,
		globalSetup: ['./scripts/test/test-network-guard.ts', './scripts/test/test-state-guard.ts'],
		setupFiles: ['./scripts/test/test-telegram-guard.ts'],
		coverage: {
			provider: 'v8',
		},
	},
})
