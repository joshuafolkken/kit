import { describe, expect, it } from 'vitest'
import {
	json_object_schema,
	overrides_snapshot_schema,
	package_version_schema,
	package_with_deps_schema,
	string_array_schema,
	vscode_settings_schema,
	with_development_deps_schema,
	with_extends_schema,
	with_scripts_schema,
} from './schemas'

const REACT_VERSION = '^18.0.0'
const VITEST_VERSION = '^4.0.0'
const PKG_NAME = 'pkg'
const BASE_JSON_EXTENDS = './base.json'

describe('overrides_snapshot_schema', () => {
	it('parses a valid overrides record', () => {
		const result = overrides_snapshot_schema.safeParse({ 'eslint-plugin-promise': '^7.2.1' })

		expect(result.success).toBe(true)
		if (result.success) expect(result.data).toStrictEqual({ 'eslint-plugin-promise': '^7.2.1' })
	})

	it('fails when a value is not a string', () => {
		expect(overrides_snapshot_schema.safeParse({ key: 42 }).success).toBe(false)
	})

	it('parses an empty record', () => {
		expect(overrides_snapshot_schema.safeParse({}).success).toBe(true)
	})
})

describe('package_version_schema', () => {
	it('parses a valid version field', () => {
		const result = package_version_schema.safeParse({ version: '1.2.3', name: 'extra-field' })

		expect(result.success).toBe(true)
		if (result.success) expect(result.data.version).toBe('1.2.3')
	})

	it('fails when version is missing', () => {
		expect(package_version_schema.safeParse({}).success).toBe(false)
	})

	it('fails when version is not a string', () => {
		expect(package_version_schema.safeParse({ version: 123 }).success).toBe(false)
	})
})

describe('package_with_deps_schema', () => {
	it('parses dependencies and devDependencies', () => {
		const result = package_with_deps_schema.safeParse({
			dependencies: { react: REACT_VERSION },
			devDependencies: { vitest: VITEST_VERSION },
		})

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.dependencies).toStrictEqual({ react: REACT_VERSION })
			expect(result.data.devDependencies).toStrictEqual({ vitest: VITEST_VERSION })
		}
	})

	it('parses empty object (both deps optional)', () => {
		expect(package_with_deps_schema.safeParse({}).success).toBe(true)
	})

	it('fails when a dep value is not a string', () => {
		expect(package_with_deps_schema.safeParse({ dependencies: { react: 18 } }).success).toBe(false)
	})
})

describe('vscode_settings_schema', () => {
	it('parses arbitrary settings object', () => {
		const settings = { tabSize: 2, formatOnSave: true }
		const result = vscode_settings_schema.safeParse(settings)

		expect(result.success).toBe(true)
		if (result.success) expect(result.data).toStrictEqual(settings)
	})

	it('parses empty object', () => {
		expect(vscode_settings_schema.safeParse({}).success).toBe(true)
	})

	it('fails for non-object', () => {
		expect(vscode_settings_schema.safeParse('invalid').success).toBe(false)
	})
})

describe('with_extends_schema', () => {
	it('parses string extends', () => {
		const result = with_extends_schema.safeParse({ extends: BASE_JSON_EXTENDS, other: 'preserved' })

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.extends).toBe(BASE_JSON_EXTENDS)
			expect(result.data).toMatchObject({ other: 'preserved' })
		}
	})

	it('parses array extends', () => {
		const result = with_extends_schema.safeParse({ extends: ['./a.json', './b.json'] })

		expect(result.success).toBe(true)
		if (result.success) expect(result.data.extends).toStrictEqual(['./a.json', './b.json'])
	})

	it('parses object without extends (optional)', () => {
		expect(with_extends_schema.safeParse({}).success).toBe(true)
	})

	it('preserves unknown fields (loose)', () => {
		const result = with_extends_schema.safeParse({ compilerOptions: { strict: true } })

		expect(result.success).toBe(true)
		if (result.success) expect(result.data).toMatchObject({ compilerOptions: { strict: true } })
	})
})

describe('with_scripts_schema', () => {
	it('parses scripts record', () => {
		const result = with_scripts_schema.safeParse({
			scripts: { build: 'tsc', test: 'vitest' },
			name: PKG_NAME,
		})

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.scripts).toStrictEqual({ build: 'tsc', test: 'vitest' })
			expect(result.data).toMatchObject({ name: PKG_NAME })
		}
	})

	it('parses without scripts (optional)', () => {
		expect(with_scripts_schema.safeParse({ name: PKG_NAME }).success).toBe(true)
	})
})

describe('with_development_deps_schema', () => {
	it('parses devDependencies', () => {
		const result = with_development_deps_schema.safeParse({
			devDependencies: { vitest: VITEST_VERSION },
			name: PKG_NAME,
		})

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.devDependencies).toStrictEqual({ vitest: VITEST_VERSION })
			expect(result.data).toMatchObject({ name: PKG_NAME })
		}
	})

	it('parses without devDependencies (optional)', () => {
		expect(with_development_deps_schema.safeParse({}).success).toBe(true)
	})
})

describe('json_object_schema', () => {
	it('parses arbitrary object', () => {
		const input = { a: 1, b: 'hello', c: false }
		const result = json_object_schema.safeParse(input)

		expect(result.success).toBe(true)
		if (result.success) expect(result.data).toStrictEqual(input)
	})

	it('fails for array', () => {
		expect(json_object_schema.safeParse([1, 2, 3]).success).toBe(false)
	})

	it('fails for primitive', () => {
		expect(json_object_schema.safeParse('string').success).toBe(false)
	})
})

describe('string_array_schema', () => {
	it('parses string array', () => {
		const result = string_array_schema.safeParse(['a', 'b', 'c'])

		expect(result.success).toBe(true)
		if (result.success) expect(result.data).toStrictEqual(['a', 'b', 'c'])
	})

	it('fails when array contains non-string', () => {
		expect(string_array_schema.safeParse(['a', 2]).success).toBe(false)
	})

	it('parses empty array', () => {
		expect(string_array_schema.safeParse([]).success).toBe(true)
	})

	it('fails for non-array', () => {
		expect(string_array_schema.safeParse('not-array').success).toBe(false)
	})
})
