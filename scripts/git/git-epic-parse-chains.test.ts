import { describe, expect, it } from 'vitest'
import { fence_mask, is_task_list_line, parse_dependency_chains } from './git-epic-parse'

// The reading half of `josh epic --add`: the chain structure an insertion positions itself in, and
// the two line-level helpers a rewriter needs to edit a body the parser will still agree with
// (joshuafolkken/kit#890).

describe('git_epic_parse.parse_dependency_chains', () => {
	it('keeps each declared line as its own chain', () => {
		expect(parse_dependency_chains('#1 -> #2 -> #3\n#7 -> #8\n')).toStrictEqual([
			[1, 2, 3],
			[7, 8],
		])
	})

	it('ignores a chain inside a fenced block', () => {
		expect(parse_dependency_chains('```md\n#9 -> #10\n```\n\n#1 -> #2\n')).toStrictEqual([[1, 2]])
	})

	it('ignores a prose line that merely recommends an order', () => {
		expect(parse_dependency_chains('推奨実行順: #869 -> #863\n')).toStrictEqual([])
	})

	it('returns nothing for an undefined body', () => {
		expect(parse_dependency_chains(undefined)).toStrictEqual([])
	})
})

describe('git_epic_parse.fence_mask', () => {
	it('marks the fence lines and everything between them as unreadable', () => {
		expect(fence_mask('a\n```\nb\n```\nc')).toStrictEqual([true, false, false, false, true])
	})

	it('treats an unterminated fence as swallowing the rest', () => {
		expect(fence_mask('a\n```\nb')).toStrictEqual([true, false, false])
	})
})

describe('git_epic_parse.is_task_list_line', () => {
	it('accepts the row shapes the whole-body scan counts', () => {
		expect(is_task_list_line('- [ ] #101')).toBe(true)
		expect(is_task_list_line('  * [x] #101 done')).toBe(true)
	})

	it('rejects a bare reference and a row with no issue', () => {
		expect(is_task_list_line('#101')).toBe(false)
		expect(is_task_list_line('- [ ] write the docs')).toBe(false)
	})
})
