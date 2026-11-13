import { describe, expect, it } from 'vitest'
import { run_startup_schema } from './run-startup-schema'

describe('run_startup_schema', () => {
	it('refuses incomplete identities and negative durations', () => {
		const row = {
			kind: 'startup',
			at: 'now',
			run: 'run',
			attempt: 'attempt',
			id: 'span',
			phase: 'install',
			edge: 'failed',
		}

		expect(run_startup_schema.entry_schema.safeParse(row).success).toBe(true)
		expect(run_startup_schema.entry_schema.safeParse({ ...row, elapsed_ms: -1 }).success).toBe(
			false,
		)
		expect(run_startup_schema.entry_schema.safeParse({ ...row, attempt: undefined }).success).toBe(
			false,
		)
	})
})
