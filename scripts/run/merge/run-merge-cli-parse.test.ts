import { describe, expect, it } from 'vitest'
import { run_merge_cli } from './run-merge-cli'

const CHILD = '2024'

describe('run_merge_cli.parse — legacy thresholds', () => {
	it('asks the cut verdict without a numeric argument', () => {
		expect(run_merge_cli.parse([CHILD])?.over).toBe(true)
	})

	it('accepts but ignores an in-flight legacy threshold', () => {
		expect(run_merge_cli.parse([CHILD, '--over', '300000'])?.over).toBe(true)
		expect(run_merge_cli.parse([CHILD, '--over', '1'])?.over).toBe(true)
	})

	it('keeps legacy threshold parsing strict', () => {
		expect(run_merge_cli.parse([CHILD, '--over', 'invalid'])).toBeUndefined()
	})
})
