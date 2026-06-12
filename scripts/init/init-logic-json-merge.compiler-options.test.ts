import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'
import { init_logic_json_merge } from './init-logic-json-merge'

const BASE_OPTIONS = {
	strict: true,
	moduleResolution: 'bundler',
	allowJs: true,
	checkJs: true,
	noEmitOnError: true,
}

const NO_EMIT_ON_ERROR = 'noEmitOnError'
const WORKER_TYPES = './worker-configuration.d.ts'
const SVELTE_KIT_EXTEND = './.svelte-kit/tsconfig.json'

function strip(content: string): Record<string, unknown> {
	return JSON.parse(
		init_logic_json_merge.strip_redundant_compiler_options(content, BASE_OPTIONS),
	) as Record<string, unknown>
}

describe('init_logic_json_merge.extract_compiler_options', () => {
	it('returns an empty object when compilerOptions is absent', () => {
		expect(init_logic_json_merge.extract_compiler_options('{"extends":["x"]}')).toStrictEqual({})
	})

	it('returns the compilerOptions object when present', () => {
		expect(
			init_logic_json_merge.extract_compiler_options('{"compilerOptions":{"strict":true}}'),
		).toStrictEqual({ strict: true })
	})

	it('parses jsonc by stripping comments and trailing commas', () => {
		const content = '{\n\t// preset\n\t"compilerOptions": {\n\t\t"strict": true,\n\t},\n}'

		expect(init_logic_json_merge.extract_compiler_options(content)).toStrictEqual({ strict: true })
	})
})

describe('init_logic_json_merge.strip_redundant_compiler_options — removal', () => {
	it('removes compilerOptions entirely when every key equals the base preset', () => {
		const content = JSON.stringify({
			extends: ['kit'],
			compilerOptions: { strict: true, allowJs: true, moduleResolution: 'bundler' },
		})

		expect(strip(content)).toStrictEqual({ extends: ['kit'] })
	})

	it('preserves extends, include, and exclude untouched', () => {
		const content = JSON.stringify({
			extends: ['kit', SVELTE_KIT_EXTEND],
			compilerOptions: { strict: true },
			include: ['src'],
			exclude: ['node_modules'],
		})

		expect(strip(content)).toStrictEqual({
			extends: ['kit', SVELTE_KIT_EXTEND],
			include: ['src'],
			exclude: ['node_modules'],
		})
	})
})

describe('init_logic_json_merge.strip_redundant_compiler_options — preservation', () => {
	it('keeps a value-divergent override and drops redundant siblings', () => {
		const content = JSON.stringify({ compilerOptions: { strict: true, [NO_EMIT_ON_ERROR]: false } })

		expect(strip(content)).toStrictEqual({ compilerOptions: { [NO_EMIT_ON_ERROR]: false } })
	})

	it('keeps a key absent from the base preset (project-specific)', () => {
		const content = JSON.stringify({ compilerOptions: { strict: true, types: [WORKER_TYPES] } })

		expect(strip(content)).toStrictEqual({ compilerOptions: { types: [WORKER_TYPES] } })
	})

	it('returns content unchanged when there is no compilerOptions', () => {
		const content = '{"extends":["kit"]}'

		expect(init_logic_json_merge.strip_redundant_compiler_options(content, BASE_OPTIONS)).toBe(
			content,
		)
	})

	it('returns content unchanged when no key is redundant', () => {
		const content = `{"compilerOptions":{"${NO_EMIT_ON_ERROR}":false}}`

		expect(init_logic_json_merge.strip_redundant_compiler_options(content, BASE_OPTIONS)).toBe(
			content,
		)
	})
})

describe('init_logic.get_tsconfig_preset_filename', () => {
	it('returns the preset basename within the package tsconfig directory', () => {
		expect(init_logic.get_tsconfig_preset_filename('sveltekit')).toBe('sveltekit.jsonc')
		expect(init_logic.get_tsconfig_preset_filename('vanilla')).toBe('base.jsonc')
	})
})
