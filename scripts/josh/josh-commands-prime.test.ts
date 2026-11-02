import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { PRIME_COMMANDS } from './josh-commands-prime'

describe('PRIME_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(PRIME_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('runs run:prime from its own script', () => {
		expect(COMMAND_MAP['run:prime']?.script).toBe('scripts/run/prime/run-prime-cli.ts')
	})
})
