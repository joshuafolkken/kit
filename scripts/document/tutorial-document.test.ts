import { describe, expect, it } from 'vitest'
import { all_documents, linked_paths, read_document } from './ai-document-fixture'

// The first-change tutorial (joshuafolkken/kit#2714): one page that walks the Issue-driven loop end
// to end. It only stays true while the command-name and link-resolution scans walk it, and it is only
// found while the install guides and the overview route readers to it.
const TUTORIAL = 'docs/tutorial.md'
const ENTRY_DOCUMENTS: ReadonlyArray<string> = [
	'docs/getting-started.md',
	'docs/package.md',
	'docs/overview.md',
]
// One marker per step of the loop, in the order the page walks them.
const LOOP_STEPS: ReadonlyArray<string> = [
	'gh issue create',
	'kickoff #N',
	'halfrun #N',
	'pnpm josh gate',
	'pnpm josh git',
	'pnpm josh sync',
]
const VERIFYING_HEADING = '## Verifying this guide'

describe('the first-change tutorial', () => {
	it('is in the scanned document set', () => {
		expect(all_documents()).toContain(TUTORIAL)
	})

	it('walks every step of the loop in order', () => {
		const text = read_document(TUTORIAL)
		const positions = LOOP_STEPS.map((step) => text.indexOf(step))

		expect(positions).not.toContain(-1)
		expect(positions).toStrictEqual(positions.toSorted((left, right) => left - right))
	})

	it('records how the guide was verified', () => {
		expect(read_document(TUTORIAL)).toContain(VERIFYING_HEADING)
	})

	it.each(ENTRY_DOCUMENTS)('%s links to the tutorial', (path) => {
		expect(linked_paths(path)).toContain(TUTORIAL)
	})
})
