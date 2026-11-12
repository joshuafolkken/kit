import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'

describe('PRIME_COMMANDS', () => {
	it('runs run:prime from its own script', () => {
		expect(COMMAND_MAP['run:prime']?.script).toBe('scripts/run/prime/run-prime-cli.ts')
	})
})
