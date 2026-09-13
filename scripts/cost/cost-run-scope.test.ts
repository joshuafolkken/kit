import { describe, expect, it } from 'vitest'
import type { Options } from './cost-cli'
import { cost_run_scope } from './cost-run-scope'

function options(over: Partial<Options>): Options {
	return { is_all: false, is_json: false, is_run: false, ...over }
}

describe('cost_run_scope.wants', () => {
	it('is the bare no-argument default', () => {
		expect(cost_run_scope.wants(options({}))).toBe(true)
	})

	it('is what --run names explicitly', () => {
		expect(cost_run_scope.wants(options({ is_run: true }))).toBe(true)
	})

	it('yields to a narrower scope', () => {
		expect(cost_run_scope.wants(options({ session: 'a' }))).toBe(false)
		expect(cost_run_scope.wants(options({ issue: 5 }))).toBe(false)
		expect(cost_run_scope.wants(options({ is_all: true }))).toBe(false)
	})

	it('yields to a per-request verdict, which is about the current session', () => {
		expect(cost_run_scope.wants(options({ over: 100 }))).toBe(false)
		expect(cost_run_scope.wants(options({ cap: 100 }))).toBe(false)
	})
})

describe('cost_run_scope.is_conflict', () => {
	it('refuses --run beside any competing flag', () => {
		expect(cost_run_scope.is_conflict(true, [false, true, false])).toBe(true)
	})

	it('allows --run alone, and never fires without it', () => {
		expect(cost_run_scope.is_conflict(true, [false, false, false])).toBe(false)
		expect(cost_run_scope.is_conflict(false, [true, true, true])).toBe(false)
	})
})
