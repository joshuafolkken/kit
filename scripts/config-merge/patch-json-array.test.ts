import { describe, expect, it } from 'vitest'
import { parse_jsonc } from './parse-jsonc'
import { patch_json_array } from './patch-json-array'

const KIT = { id: 'kit', run: ['a', 'b'] }
const OWN = { id: 'own', run: [] }

function upsert_kit(content: string): string {
	return patch_json_array.upsert_element(content, {
		key: 'items',
		value: KIT,
		is_target: (element) => JSON.stringify(element).includes('"id":"kit"'),
	})
}

function items_of(content: string): unknown {
	return parse_jsonc(content)['items']
}

describe('patch_json_array.upsert_element — append', () => {
	it('keeps a comment inside another element when it appends', () => {
		const existing =
			'{\n\t"items": [\n\t\t{\n\t\t\t// mine\n\t\t\t"id": "own",\n\t\t\t"run": []\n\t\t}\n\t]\n}\n'
		const merged = upsert_kit(existing)

		expect(merged).toContain('// mine')
		expect(items_of(merged)).toStrictEqual([OWN, KIT])
	})

	it('appends at the element depth with the inline array prettier keeps', () => {
		const existing = '{\n\t"items": [\n\t\t{ "id": "own", "run": [] }\n\t]\n}\n'

		expect(upsert_kit(existing)).toBe(
			'{\n\t"items": [\n\t\t{ "id": "own", "run": [] },\n\t\t{\n\t\t\t"id": "kit",\n\t\t\t"run": ["a", "b"]\n\t\t}\n\t]\n}\n',
		)
	})

	it('creates the array when it is absent or empty', () => {
		expect(items_of(upsert_kit('{}'))).toStrictEqual([KIT])
		expect(items_of(upsert_kit('{ "items": [] }'))).toStrictEqual([KIT])
	})

	it('leaves an element that is not an object untouched', () => {
		const existing = '{\n\t"items": [\n\t\t"loose"\n\t]\n}\n'

		expect(items_of(upsert_kit(existing))).toStrictEqual(['loose', KIT])
	})
})

describe('patch_json_array.upsert_element — replace', () => {
	it('replaces the matched element in place and keeps the comment beside the next one', () => {
		const stale = JSON.stringify({ id: 'kit', run: [] })
		const existing = `{\n\t"items": [\n\t\t${stale},\n\t\t// mine\n\t\t${JSON.stringify(OWN)}\n\t]\n}\n`
		const merged = upsert_kit(existing)

		expect(merged).toContain('// mine')
		expect(items_of(merged)).toStrictEqual([KIT, OWN])
	})

	it('returns the content unchanged when the matched element already equals the value', () => {
		const existing = `{\n\t"items": [\n\t\t/* kept */ ${JSON.stringify(KIT)}\n\t]\n}\n`

		expect(upsert_kit(existing)).toBe(existing)
	})
})
