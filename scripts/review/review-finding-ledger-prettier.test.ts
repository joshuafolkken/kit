import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import { format, getFileInfo } from 'prettier'
import { describe, expect, it } from 'vitest'
import { review_finding_ledger } from './review-finding-ledger'

// joshuafolkken/kit#5808: Prettier read the `__` of a recorded path as emphasis and rewrote
// `__snapshots__` to `**snapshots**`, so the ledger stays out of Prettier rather than being reformatted.

const ISSUE = 5804
const FILE = 'scripts/rules/__snapshots__/rule-list.txt:92'
const LEDGER = `.josh/observations/${String(ISSUE)}.md`
const IGNORE_FILES = ['.prettierignore', 'templates/prettierignore.basic']

function recorded_line(): string {
	return review_finding_ledger.finding_line(
		{ category: 'tests', severity: 'medium', file: FILE, disposition: 'fixed' },
		'2026-11-01',
		ISSUE,
	)
}

// The ledger path is resolved beside the ignore file, as Prettier resolves the file's patterns.
async function is_ignored(ignore_file: string): Promise<boolean> {
	const ignore_path = package_path(ignore_file)
	const info = await getFileInfo(path.join(path.dirname(ignore_path), LEDGER), {
		ignorePath: ignore_path,
	})

	return info.ignored
}

describe('review_finding_ledger — a recorded path that holds __', () => {
	it('is the reason: Prettier rewrites the path when it formats the line', async () => {
		const formatted = await format(recorded_line(), { parser: 'markdown' })

		expect(formatted).not.toContain(FILE)
	})

	it.each(IGNORE_FILES)('leaves the observations ledger out of Prettier in %s', async (file) => {
		expect(await is_ignored(file)).toBe(true)
	})

	it('reads the recorded line back as the issue’s record, path intact', () => {
		const line = recorded_line()

		expect(line).toContain(` | ${FILE} | `)
		expect(review_finding_ledger.has_issue_record(line, ISSUE)).toBe(true)
		expect(review_finding_ledger.issue_dispositions(line, ISSUE)).toStrictEqual([
			{ severity: 'medium', disposition: 'fixed' },
		])
	})
})
