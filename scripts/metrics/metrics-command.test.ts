import { describe, expect, it } from 'vitest'
import { metrics_command } from './metrics-command'

describe('metrics_command.parse_write_baseline', () => {
	it('prints only when no argument is given', () => {
		expect(metrics_command.parse_write_baseline([])).toBe(false)
	})

	it('writes the baseline when the flag is given', () => {
		expect(metrics_command.parse_write_baseline(['--write-baseline'])).toBe(true)
	})

	it('refuses an unknown argument', () => {
		expect(metrics_command.parse_write_baseline(['--write'])).toBeUndefined()
	})
})
