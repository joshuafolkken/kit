import { describe, expect, it } from 'vitest'
import { edit_tool } from './edit-tool'

// joshuafolkken/kit#5284: the one set of file-editing tools the `PreToolUse` rows share.

describe('edit_tool.is_edit_tool', () => {
	it('accepts Edit and Write', () => {
		expect([edit_tool.is_edit_tool('Edit'), edit_tool.is_edit_tool('Write')]).toStrictEqual([
			true,
			true,
		])
	})

	it('rejects Read and Bash', () => {
		expect([edit_tool.is_edit_tool('Read'), edit_tool.is_edit_tool('Bash')]).toStrictEqual([
			false,
			false,
		])
	})
})

describe('edit_tool.string_field', () => {
	it('reads a string field', () => {
		expect(edit_tool.string_field({ file_path: 'a.ts' }, 'file_path')).toBe('a.ts')
	})

	it('reads an absent or non-string field as empty', () => {
		expect([
			edit_tool.string_field({}, 'content'),
			edit_tool.string_field({ content: 1 }, 'content'),
		]).toStrictEqual(['', ''])
	})
})
