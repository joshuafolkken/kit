import { describe, expect, it } from 'vitest'
import { json_list } from './patch-json-list'

const EXTENDS_FIELD = 'extends'
const KIT_BASE = '@joshuafolkken/kit/tsconfig/base'
const KIT_SVELTEKIT = '@joshuafolkken/kit/tsconfig/sveltekit'
const APP_KIT_SVELTEKIT = '@joshuafolkken/app-kit/tsconfig/sveltekit'

function parse(content: string): { extends?: unknown; compilerOptions?: unknown } {
	return JSON.parse(content) as { extends?: unknown; compilerOptions?: unknown }
}

describe('json_list.patch_json_list_field — ensure', () => {
	it('prepends a new entry to an existing array', () => {
		const content = JSON.stringify({ extends: [KIT_BASE] })
		const result = parse(
			json_list.patch_json_list_field(content, { field: EXTENDS_FIELD, ensure: [KIT_SVELTEKIT] }),
		)

		expect(result.extends).toEqual([KIT_SVELTEKIT, KIT_BASE])
	})

	it('normalizes a string extends to an array before prepending', () => {
		const content = JSON.stringify({ extends: KIT_BASE })
		const result = parse(
			json_list.patch_json_list_field(content, { field: EXTENDS_FIELD, ensure: [KIT_SVELTEKIT] }),
		)

		expect(result.extends).toEqual([KIT_SVELTEKIT, KIT_BASE])
	})

	it('creates the field when absent, preserving other keys', () => {
		const content = JSON.stringify({ compilerOptions: { strict: true } })
		const result = parse(
			json_list.patch_json_list_field(content, { field: EXTENDS_FIELD, ensure: [KIT_BASE] }),
		)

		expect(result.extends).toEqual([KIT_BASE])
		expect(result.compilerOptions).toEqual({ strict: true })
	})
})

describe('json_list.patch_json_list_field — remove', () => {
	it('removes an entry matching a pattern and ensures the replacement', () => {
		const content = JSON.stringify({ extends: [KIT_SVELTEKIT, KIT_BASE] })
		const result = parse(
			json_list.patch_json_list_field(content, {
				field: EXTENDS_FIELD,
				ensure: [APP_KIT_SVELTEKIT],
				remove: [/\/sveltekit$/u],
			}),
		)

		expect(result.extends).toEqual([APP_KIT_SVELTEKIT, KIT_BASE])
	})
})

describe('json_list.patch_json_list_field — idempotency', () => {
	it('returns content unchanged when the entry is already present', () => {
		const content = JSON.stringify({ extends: [KIT_BASE] })

		expect(
			json_list.patch_json_list_field(content, { field: EXTENDS_FIELD, ensure: [KIT_BASE] }),
		).toBe(content)
	})

	it('is a no-op on a second run', () => {
		const first = json_list.patch_json_list_field(JSON.stringify({ compilerOptions: {} }), {
			field: EXTENDS_FIELD,
			ensure: [KIT_BASE],
		})
		const second = json_list.patch_json_list_field(first, {
			field: EXTENDS_FIELD,
			ensure: [KIT_BASE],
		})

		expect(second).toBe(first)
	})

	it('serializes with tab indentation and a trailing newline', () => {
		const result = json_list.patch_json_list_field(JSON.stringify({}), {
			field: EXTENDS_FIELD,
			ensure: [KIT_BASE],
		})

		expect(result).toBe(`{\n\t"extends": [\n\t\t"${KIT_BASE}"\n\t]\n}\n`)
	})
})
