import { describe, expect, it } from 'vitest'
import { config } from './basic.js'

describe('basic Prettier preset', () => {
	it('formats CSS without optional plugins', async () => {
		const prettier = await import('prettier')
		const output = await prettier.format('body{color:red}', { ...config, parser: 'css' })

		expect(output).toContain('color: red')
		expect(config).not.toHaveProperty('plugins')
	})
})
