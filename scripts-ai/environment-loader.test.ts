import { describe, expect, it, vi } from 'vitest'
import { load_optional_environment } from './environment-loader'

describe('load_optional_environment — .env absent', () => {
	it('does not throw when loadEnvFile throws', () => {
		vi.stubGlobal('process', {
			...process,
			loadEnvFile: () => {
				throw new Error('ENOENT')
			},
		})

		expect(() => {
			load_optional_environment()
		}).not.toThrow()

		vi.unstubAllGlobals()
	})
})

describe('load_optional_environment — .env present', () => {
	it('calls loadEnvFile with .env path', () => {
		const load_spy = vi.fn()

		vi.stubGlobal('process', { ...process, loadEnvFile: load_spy })
		load_optional_environment()

		expect(load_spy).toHaveBeenCalledWith('.env')

		vi.unstubAllGlobals()
	})
})
