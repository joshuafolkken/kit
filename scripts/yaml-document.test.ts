import { describe, expect, it } from 'vitest'
import { yaml_document } from './yaml-document'

const OVERRIDES_YAML = 'overrides:\n  svelte: ^5\n'
const OVERRIDES_PARSED = { overrides: { svelte: '^5' } }
const EMPTY_DOCUMENTS = ['', '   \n', '# only a comment\n']

describe('yaml_document.parse_yaml', () => {
	it('parses a mapping into a plain object', () => {
		expect(yaml_document.parse_yaml(OVERRIDES_YAML)).toStrictEqual(OVERRIDES_PARSED)
	})

	// js-yaml 5 throws on a document with no node; the shared reader restores the v4 empty-object
	// semantics so an absent or comment-only config file is readable rather than fatal.
	it.each(EMPTY_DOCUMENTS)('returns an empty object for %j', (content) => {
		expect(yaml_document.parse_yaml(content)).toStrictEqual({})
	})

	it('rejects a document whose root is not a mapping', () => {
		expect(() => yaml_document.parse_yaml('- a\n- b\n')).toThrow()
	})
})

// pnpm 11 writes pnpm-lock.yaml as a multi-document stream, which `parse_yaml` rejects outright.
describe('yaml_document.parse_yaml_documents', () => {
	it('returns every mapping document in the stream', () => {
		const content = `lockfileVersion: '9.0'\n---\n${OVERRIDES_YAML}`

		expect(yaml_document.parse_yaml_documents(content)).toStrictEqual([
			{ lockfileVersion: '9.0' },
			OVERRIDES_PARSED,
		])
	})

	it('reads a single-document stream as one entry', () => {
		expect(yaml_document.parse_yaml_documents(OVERRIDES_YAML)).toStrictEqual([OVERRIDES_PARSED])
	})

	it.each(EMPTY_DOCUMENTS)('returns no documents for %j', (content) => {
		expect(yaml_document.parse_yaml_documents(content)).toStrictEqual([])
	})

	it('drops documents whose root is not a mapping', () => {
		expect(yaml_document.parse_yaml_documents('- a\n---\nkey: value\n')).toStrictEqual([
			{ key: 'value' },
		])
	})
})
