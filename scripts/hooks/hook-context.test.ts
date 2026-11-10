import { describe, expect, it } from 'vitest'
import { hook_context } from './hook-context'

describe('hook_context.from_process', () => {
	it('carries the launched process cwd and environment', () => {
		const context = hook_context.from_process()

		expect(context.cwd).toBe(process.cwd())
		expect(context.env).toBe(process.env)
	})
})
