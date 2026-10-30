import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_carry } from './run-carry'

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-scheduler-'))
const INVOCATION = 'backlogrun'

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('run_carry scheduler', () => {
	it.each(['anthropic', 'openai'] as const)('keeps %s through persistence', (provider) => {
		const target = path.join(scratch, `${provider}.json`)
		const carry = run_carry.begin_carry(target, INVOCATION, { provider })

		expect(run_carry.read_carry(target)).toMatchObject({
			carry: { scheduler_provider: provider },
		})
		expect(carry).toMatchObject({ scheduler_provider: provider })
	})

	it.each(['anthropic', 'openai', undefined] as const)(
		'uses the new owner provider %s after adoption',
		(provider) => {
			const target = path.join(scratch, `adopt-${String(provider)}.json`)
			const carry = run_carry.begin_carry(target, INVOCATION, { provider: 'openai' })

			if (carry === undefined) throw new Error('the test record was not created')
			expect(run_carry.adopt_carry(target, carry, { provider })?.scheduler_provider).toBe(provider)
			expect(run_carry.read_carry(target)).toMatchObject({
				carry: provider === undefined ? {} : { scheduler_provider: provider },
			})
		},
	)
})
