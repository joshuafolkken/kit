import { describe, expect, it } from 'vitest'
import { test_runner_config } from './test-runner-config'

describe('test_runner_config.is_config', () => {
	it('accepts a vitest or vite configuration at the repository root', () => {
		expect(test_runner_config.is_config('vitest.config.ts')).toBe(true)
		expect(test_runner_config.is_config('vite.config.js')).toBe(true)
	})

	it('rejects one nested below the root and any other root file', () => {
		expect(test_runner_config.is_config('fixtures/vite.config.ts')).toBe(false)
		expect(test_runner_config.is_config('vitest.setup.ts')).toBe(false)
		expect(test_runner_config.is_config('eslint.config.js')).toBe(false)
	})
})
