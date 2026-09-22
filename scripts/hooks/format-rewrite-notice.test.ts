import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_REWRITE_CHARS, rewrite_notice } from './format-rewrite-notice'

// Its own temp directory and teardown: vitest isolates test files, so the read_text cases here do not
// share the sibling suites' fixtures (see format-edited-file.test.ts for why it lives under the OS
// temp dir).
const TEST_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'format-rewrite-'))
// The formatted single line, reused as the after-side of a build and as read_text's fixture content.
const FORMATTED_LINE = 'const a = 1\n'

afterAll(() => {
	rmSync(TEST_DIRECTORY, { recursive: true, force: true })
})

// The format hook rewrites a file in place, so the model's copy goes stale and its next Edit misses.
// build returns the fact plus the changed region so the model reissues against current text; an edit
// formatting left untouched must add nothing at all (joshuafolkken/kit#2314).
describe('rewrite_notice.build', () => {
	// The ordinary edit — prettier and eslint changed nothing — must add nothing, so the harness parses
	// nothing extra.
	it('returns nothing when the content is unchanged', () => {
		const source = 'const a = 1\nconst b = 2\n'

		expect(rewrite_notice.build(source, source)).toBeUndefined()
	})

	it('names the file stale and points the model to re-read', () => {
		const notice = rewrite_notice.build('const a=1\n', FORMATTED_LINE)

		expect(notice).toContain('stale')
		expect(notice).toContain('re-read')
	})

	// The common head and tail are trimmed, so the range points at the line that moved rather than the
	// whole file, and carries the new text of that line.
	it('reports the changed line range and its new text', () => {
		const before = 'const a = 1\nconst  b   =2\nconst c = 3\n'
		const after = 'const a = 1\nconst b = 2\nconst c = 3\n'
		const notice = rewrite_notice.build(before, after)

		expect(notice).toContain('lines 2-2')
		expect(notice).toContain('const b = 2')
	})

	// additionalContext rides back on the edit, so a large reformat is cut to the bound and marked.
	it('truncates a large changed region past the bound and marks the cut', () => {
		const after = `${'x'.repeat(MAX_REWRITE_CHARS + 500)}\n`
		const notice = rewrite_notice.build('', after)

		expect(notice).toContain('truncated')
		expect(notice?.length).toBeLessThan(after.length)
	})
})

describe('rewrite_notice.read_text', () => {
	it.each([
		['no path was handed to the hook', undefined],
		['the file is gone by the time it reads', path.join(TEST_DIRECTORY, 'missing.ts')],
	])('reads an empty string when %s', (_label, file_path) => {
		expect(rewrite_notice.read_text(file_path)).toBe('')
	})

	it('reads the content of a file that exists', () => {
		const file_path = path.join(TEST_DIRECTORY, 'present.ts')

		writeFileSync(file_path, FORMATTED_LINE, 'utf8')

		expect(rewrite_notice.read_text(file_path)).toBe(FORMATTED_LINE)
	})
})
