import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { inherited_scope } from './inherited-scope'

const KEY = 'scope-fixture'
const schema = z.object({ attempt: z.string() })
const scope = inherited_scope.create(KEY, schema)

afterEach(() => vi.unstubAllEnvs())

describe('inherited_scope', () => {
	it('isolates parallel scopes and shares bundled copies', async () => {
		const copy = inherited_scope.create(KEY, schema)
		const results = await Promise.all(
			['first', 'second'].map(
				async (attempt) =>
					await scope.within({ attempt }, async () => {
						await Promise.resolve()

						return copy.current()
					}),
			),
		)

		expect(results).toEqual([{ attempt: 'first' }, { attempt: 'second' }])
		expect(scope.current()).toBeUndefined()
	})
	it('validates inherited values and lets local scopes override them', async () => {
		vi.stubEnv(KEY, JSON.stringify({ attempt: 'parent' }))
		expect(scope.current()).toEqual({ attempt: 'parent' })
		await scope.within({ attempt: 'child' }, async () => {
			expect(JSON.parse(scope.environment()[KEY] ?? '')).toEqual({ attempt: 'child' })
		})
		vi.stubEnv(KEY, 'invalid')
		expect(scope.current()).toBeUndefined()
		expect(scope.environment()).toEqual({})
	})
})
