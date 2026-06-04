import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

describe('get_development_engines_value', () => {
	it('enforces pnpm v11 minimum version', () => {
		const result = init_logic.get_development_engines_value()

		expect(result.packageManager.name).toBe('pnpm')
		expect(result.packageManager.version).toBe('>=11.0.0-0')
		expect(result.packageManager.onFail).toBe('error')
	})
})
