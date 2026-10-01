import { describe, expect, it } from 'vitest'
import { config as basic_config } from './basic.js'
import { config } from './static.js'

// joshuafolkken/kit#2829 renamed the static profile to basic; a project initialized before it still
// imports `@joshuafolkken/kit/prettier/static`.
describe('static Prettier preset (pre-rename import path)', () => {
	it('is the basic preset', () => {
		expect(config).toBe(basic_config)
	})
})
