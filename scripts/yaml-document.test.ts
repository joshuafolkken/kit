import { describe, expect, it } from 'vitest'
import { yaml_document } from './yaml-document'

describe('yaml_document.parse_yaml', () => {
	it('parses a mapping into a plain object', () => {
		expect(yaml_document.parse_yaml('overrides:\n  svelte: ^5\n')).toStrictEqual({
			overrides: { svelte: '^5' },
		})
	})

	// js-yaml 5 throws on a document with no node; the shared reader restores the v4 empty-object
	// semantics so an absent or comment-only config file is readable rather than fatal.
	it.each(['', '   \n', '# only a comment\n'])('returns an empty object for %j', (content) => {
		expect(yaml_document.parse_yaml(content)).toStrictEqual({})
	})

	it('rejects a document whose root is not a mapping', () => {
		expect(() => yaml_document.parse_yaml('- a\n- b\n')).toThrow()
	})
})
