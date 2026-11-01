import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { issue_file_batch_entries } from './issue-file-batch-entries'

// joshuafolkken/kit#5660: `josh issue:file --batch <dir>` reads each body file's title from its front
// matter or its first line, and its `--distinct` from the front matter.

const SOURCE = 'one.md'
const TITLE = 'Add a batch filing'
const BODY = '## 背景\n\nx\n'

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-batch-entries-'))

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe('issue_file_batch_entries.entry_of — the title, body and distinct of one body file', () => {
	it('reads the title and distinct from the front matter', () => {
		const text = `---\ntitle: ${TITLE}\ndistinct: 12,34\n---\n\n${BODY}`

		expect(issue_file_batch_entries.entry_of(text, SOURCE)).toStrictEqual({
			source: SOURCE,
			title: TITLE,
			body: BODY,
			distinct: '12,34',
		})
	})

	it('reads the title from the first line, dropping a heading marker', () => {
		expect(issue_file_batch_entries.entry_of(`# ${TITLE}\n\n${BODY}`, SOURCE)).toStrictEqual({
			source: SOURCE,
			title: TITLE,
			body: BODY,
			distinct: undefined,
		})
	})
})

describe('issue_file_batch_entries.entry_of — front matter written other ways', () => {
	it('reads the title from the first body line when the front matter has no title', () => {
		const text = `---\ndistinct: 12\n---\n\n# ${TITLE}\n\n${BODY}`

		expect(issue_file_batch_entries.entry_of(text, SOURCE)).toStrictEqual({
			source: SOURCE,
			title: TITLE,
			body: BODY,
			distinct: '12',
		})
	})

	it('reads the front matter of a CRLF body file', () => {
		const text = `---\r\ntitle: ${TITLE}\r\n---\r\n${BODY}`

		expect(issue_file_batch_entries.entry_of(text, SOURCE).title).toBe(TITLE)
	})

	it('drops one pair of quotes around a front matter value', () => {
		const text = `---\ntitle: "${TITLE}"\n---\n${BODY}`

		expect(issue_file_batch_entries.entry_of(text, SOURCE).title).toBe(TITLE)
	})
})

describe('issue_file_batch_entries.entries_of — the body files of a directory', () => {
	it('reads every .md file in name order and skips other files', async () => {
		writeFileSync(path.join(work, 'b.md'), 'Second\nbody b\n')
		writeFileSync(path.join(work, 'a.md'), 'First\nbody a\n')
		writeFileSync(path.join(work, 'notes.txt'), 'Ignored\n')

		const entries = await issue_file_batch_entries.entries_of(work)

		expect(entries.map((entry) => entry.title)).toStrictEqual(['First', 'Second'])
		expect(entries[0]?.source).toBe(path.join(work, 'a.md'))
	})
})
