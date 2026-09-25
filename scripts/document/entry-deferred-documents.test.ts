import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { document_reachability } from './document-reachability'
import { entry_read_set } from './entry-read-set'

const ROOT = process.cwd()
const DIRECTORY = path.join(ROOT, entry_read_set.SKILL_DIRECTORY)
const ORDINARY_ENTRIES = ['kickoff', 'fullrun', 'halfrun', 'backlogrun']
const DELEGATION = 'delegation.md'
const SCOUT = 'issue-scout.md'
const DEFERRED = [DELEGATION, SCOUT]

function document(name: string): string {
	return readFileSync(path.join(DIRECTORY, name), 'utf8')
}

describe('decision procedures are delivered when needed', () => {
	it.each(ORDINARY_ENTRIES)('%s costs decision documents after entry', (entry) => {
		const read_set = entry_read_set.read_set(ROOT, entry)
		const later = entry_read_set.costed(ROOT, entry).point_of_use.map((one) => one.file)

		for (const name of DEFERRED) {
			expect(read_set.files).not.toContain(name)
			expect(later).toContain(name)
		}
	})

	it('covers the deferred documents in the total-read budget', () => {
		const covered = document_reachability.covered_documents(ROOT)

		for (const name of DEFERRED) {
			expect(covered).toContain(path.join(entry_read_set.SKILL_DIRECTORY, name))
		}
	})

	it('keeps the trigger at entry and the delegation safeguards at their pointer', () => {
		expect(document('SKILL.md')).toContain('Read `delegation.md` at the first delegation decision')
		expect(document(DELEGATION)).toContain('Anything not on the list is `keep`')
		expect(document(DELEGATION)).toContain('The threshold is 3 files')
		expect(document(DELEGATION)).toContain('`human_review:`')
	})

	it('keeps the filing trigger and the duplicate decisions reachable', () => {
		expect(document('SKILL.md')).toContain('Read `issue-scout.md` at that point')
		expect(document(SCOUT)).toContain('A candidate marked `(closed)`')
		expect(document(SCOUT)).toContain('`Epic: not asked`')
		expect(document('observation-filing.md')).toContain('second filing of the run')
	})

	it('starts a numbered fullrun with the folded entry command', () => {
		expect(document('SKILL.md')).toContain('`fullrun #N` first runs')
		expect(document('SKILL.md')).toContain('`pnpm josh run:entry <N>`')
		expect(document('fullrun.md')).toContain('For `fullrun #N`, first run the folded')
	})
})
