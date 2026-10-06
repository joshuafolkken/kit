import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { capped_print_part } from './capped-print-part'

// joshuafolkken/kit#3332: the writer and the investigation guard share one spelling of a part's shape.

const DIRECTORY = path.join('/tmp', `${capped_print_part.DIRECTORY_PREFIX}AbC123`)

describe('capped_print_part.part_name — the file name of the Nth part', () => {
	it('numbers parts from one', () => {
		expect(capped_print_part.part_name(0)).toBe('part-1.md')
		expect(capped_print_part.part_name(1)).toBe('part-2.md')
	})
})

describe('capped_print_part.is_part_file — whether a path is a part the writer made', () => {
	it('recognizes a written part under the writer directory', () => {
		const part = path.join(DIRECTORY, capped_print_part.part_name(0))

		expect(capped_print_part.is_part_file(part)).toBe(true)
	})

	it.each([
		path.join(DIRECTORY, 'notes.md'),
		path.join(DIRECTORY, 'part-0.md'),
		path.join(DIRECTORY, 'part-1.md.bak'),
		path.join('/tmp', 'other-directory', 'part-1.md'),
	])('rejects %s', (target) => {
		expect(capped_print_part.is_part_file(target)).toBe(false)
	})
})
