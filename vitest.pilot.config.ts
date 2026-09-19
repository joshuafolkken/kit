import { defineConfig } from 'vitest/config'
import { PILOT_FILES } from './scripts/test/pilot-files'

const TEST_TIMEOUT_MS = 10_000

export default defineConfig({
	test: {
		env: {
			CLAUDE_CODE_SESSION_ID: 'vitest-session',
			CODEX_THREAD_ID: '',
		},
		include: [...PILOT_FILES],
		poolOptions: {
			forks: {
				isolate: false,
			},
		},
		testTimeout: TEST_TIMEOUT_MS,
		globalSetup: ['./scripts/test/test-network-guard.ts', './scripts/test/test-state-guard.ts'],
		coverage: {
			provider: 'v8',
		},
	},
})
