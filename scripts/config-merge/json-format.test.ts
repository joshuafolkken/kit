import { describe, expect, it } from 'vitest'
import { json_format } from './json-format'
import { prettier_format_json, prettier_format_package_json } from './prettier-json-fixture'

describe('json_format.format_json — prettier-compatible arrays', () => {
	it('keeps a short primitive array inline', () => {
		const result = json_format.format_json({ exclude: ['node_modules', 'build', 'dist'] })

		expect(result).toBe('{\n\t"exclude": ["node_modules", "build", "dist"]\n}\n')
	})

	it('breaks an array that exceeds printWidth onto multiple lines', () => {
		const long = Array.from(
			{ length: 8 },
			(_value, index) => `./some/long/path/segment-${String(index)}`,
		)
		const result = json_format.format_json({ include: long })

		expect(result).toContain('\t"include": [\n')
	})

	it('keeps an inline array with a trailing comma when it is not the last key', () => {
		const result = json_format.format_json({ exclude: ['build', 'dist'], strict: true })

		expect(result).toContain('\t"exclude": ["build", "dist"],\n')
	})

	it('breaks an array holding nested structures like prettier', () => {
		const result = json_format.format_json({ references: [{ path: './tsconfig.node.json' }] })

		expect(result).toContain('\t"references": [\n')
	})

	it('renders an empty array inline', () => {
		expect(json_format.format_json({ words: [] })).toBe('{\n\t"words": []\n}\n')
	})

	// A string element containing a bracket (glob character class) must not be mistaken for a nested
	// structure — it is still a leaf, so a short such array stays inline like prettier.
	it('inlines a short array whose string element contains a bracket', () => {
		const result = json_format.format_json({ include: ['src/[abc]/*.ts', 'src/**/*.ts'] })

		expect(result).toBe('{\n\t"include": ["src/[abc]/*.ts", "src/**/*.ts"]\n}\n')
	})
})

// The one behavior that must match prettier: a short primitive array stays on one line, while a
// long one (or one holding a nested structure) breaks. Rather than re-assert prettier's algorithm
// by hand, this case formats our output through real prettier and asserts it is a fixed point.
describe('json_format.format_json — matches real prettier', () => {
	it('is a prettier fixed point across mixed array shapes', async () => {
		const value = {
			extends: [
				'./node_modules/@joshuafolkken/kit/tsconfig/base.json',
				'./node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.json',
				'./.svelte-kit/tsconfig.json',
			],
			include: ['./.svelte-kit/ambient.d.ts', './**/*.ts', './**/*.svelte', './**/*.js'],
			exclude: ['node_modules', 'build', 'dist'],
			compilerOptions: { strict: true, paths: { $lib: ['./src/lib'] } },
		}
		const formatted = json_format.format_json(value)

		expect(await prettier_format_json(formatted)).toBe(formatted)
	})
})

// prettier picks `json-stringify` for package.json from the filename alone, and that printer never
// inlines an array — so `format_json`'s inlining, correct for every other managed config, produced a
// file the consumer's own `prettier --check` rejected (#797).
describe('json_format.format_package_json — matches real prettier', () => {
	const PACKAGE_VALUE = {
		name: 'demo',
		version: '1.0.0',
		keywords: ['cli', 'tool'],
		files: ['dist'],
		scripts: { build: 'tsc' },
	}

	it('leaves a short array expanded rather than inlining it', () => {
		const result = json_format.format_package_json(PACKAGE_VALUE)

		expect(result).toContain('"keywords": [\n\t\t"cli",\n\t\t"tool"\n\t]')
	})

	it('is a prettier fixed point for a package.json', async () => {
		const formatted = json_format.format_package_json(PACKAGE_VALUE)

		expect(await prettier_format_package_json(formatted)).toBe(formatted)
	})

	// The regression this replaced: the same value through the general serializer is NOT clean.
	it('differs from format_json, which prettier rejects for this filename', async () => {
		const inlined = json_format.format_json(PACKAGE_VALUE)

		expect(await prettier_format_package_json(inlined)).not.toBe(inlined)
	})
})
