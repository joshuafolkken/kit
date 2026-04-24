import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { package_version_schema } from './schemas'

describe('package_version_schema — valid input', () => {
	it('parses a semver version string', () => {
		const result = package_version_schema.parse({ version: '1.2.3' })

		expect(result.version).toBe('1.2.3')
	})

	it('strips unknown fields from the result', () => {
		const result = package_version_schema.parse({ version: '0.1.0', name: 'kit', extra: true })

		expect(result).toStrictEqual({ version: '0.1.0' })
	})
})

describe('package_version_schema — invalid input', () => {
	it('throws ZodError when version field is missing', () => {
		expect(() => package_version_schema.parse({ name: 'kit' })).toThrow(ZodError)
	})

	it('throws ZodError when version is a number instead of string', () => {
		expect(() => package_version_schema.parse({ version: 42 })).toThrow(ZodError)
	})

	it('throws ZodError for non-object input', () => {
		expect(() => package_version_schema.parse('string')).toThrow(ZodError)
	})
})
