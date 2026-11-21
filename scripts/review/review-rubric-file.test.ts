import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it } from 'vitest'
import { review_rubric_file } from './review-rubric-file'

const ROUND_ONE = 1
const create_root = temporary_directory()
const written: Array<string> = []

afterEach(() => {
	for (const file of written.splice(0)) rmSync(file, { force: true })
})

function root(): string {
	return create_root('rubric-file-')
}

describe('review_rubric_file.path_for', () => {
	it('names a trimmed copy when the diff lets sections go', () => {
		const copy = review_rubric_file.path_for(root(), ['a.md'], ROUND_ONE)

		written.push(copy)

		expect(copy).not.toBe(review_rubric_file.SOURCE_PATH)
		expect(path.basename(copy).startsWith(review_rubric_file.PREFIX)).toBe(true)
		expect(readFileSync(copy, 'utf8')).not.toContain('### 6. Tests')
	})

	it('names the whole rubric when every section is needed', () => {
		expect(review_rubric_file.path_for(root(), ['LICENSE'], ROUND_ONE)).toBe(
			review_rubric_file.SOURCE_PATH,
		)
	})

	it('falls back to the source path when the rubric cannot be read', () => {
		const missing = path.join(root(), 'missing.md')

		expect(review_rubric_file.path_for(root(), ['a.md'], ROUND_ONE, missing)).toBe(missing)
	})
})
