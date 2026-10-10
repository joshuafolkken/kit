import { describe, expect, it } from 'vitest'
import { all_documents, linked_paths, read_document } from './ai-document-fixture'

// The first-change tutorial (joshuafolkken/kit#2714): one page that walks the Issue-driven loop end
// to end. It only stays true while the command-name and link-resolution scans walk it, and it is only
// found while the install guides and the overview route readers to it.
const TUTORIAL = 'docs/tutorial.md'
const BASIC_GUIDE = 'docs/setup/basic.md'
const FULL_GUIDE = 'docs/setup/full.md'
const ENTRY_DOCUMENTS: ReadonlyArray<string> = [BASIC_GUIDE, FULL_GUIDE, 'docs/overview.md']

// The two ways the loop is run, each walked as its own section: one Issue at a time, and many Issues
// filed first then drained unattended. One marker per step, in the order the section walks them.
interface Pattern {
	heading: string
	next_heading: string
	steps: ReadonlyArray<string>
}

const PATTERN_A = '## Pattern A'
const PATTERN_B = '## Pattern B'
const KICKOFF_NEW = 'kickoff new'
const PATTERNS: ReadonlyArray<Pattern> = [
	{
		heading: PATTERN_A,
		next_heading: PATTERN_B,
		steps: [KICKOFF_NEW, 'halfrun #N', 'fullrun #N'],
	},
	{
		heading: PATTERN_B,
		next_heading: '## Separately',
		steps: [KICKOFF_NEW, 'auto-ok', 'backlogrun'],
	},
]
// How the tutorial was verified is a maintainer record (joshuafolkken/kit#2993): it lives under
// `docs/maintainers/`, linked back to the tutorial, and the user-facing page carries only the steps.
const VERIFICATION_RECORD = 'docs/maintainers/guide-verification.md'
const VERIFYING_HEADING = '## Verifying this guide'
// Both patterns need GitHub, so a reader who ran `josh init` without it is routed to the one section
// that needs neither `gh` nor an Issue — from the README's "AI assistant only" path and both guides.
const LOCAL_HEADING = '## Without GitHub: one change, checked locally'
const LOCAL_ANCHOR = 'tutorial.md#without-github-one-change-checked-locally'
const LOCAL_ENTRY_DOCUMENTS: ReadonlyArray<string> = ['README.md', BASIC_GUIDE, FULL_GUIDE]
// The section is the only stop on the README's no-GitHub path, so it has to name what `josh init`
// set up itself — the same two links under "Before you start" sit on the path that needs GitHub.
const LOCAL_NEXT_HEADING = '## Where next'
const LOCAL_GUIDE_LINKS: ReadonlyArray<string> = ['](./setup/basic.md', '](./setup/full.md']
// A `full` project with no Git repository has to create `.gitignore` by hand before the gate runs, and
// the prerequisites put Windows readers in PowerShell, where `touch` does not exist — one command each.
const LOCAL_GITIGNORE_COMMANDS: ReadonlyArray<string> = [
	'touch .gitignore',
	'New-Item .gitignore -ItemType File',
]

function section(text: string, heading: string, next_heading: string): string {
	const start = text.indexOf(heading)
	const end = text.indexOf(next_heading, start)

	expect(start).not.toBe(-1)
	expect(end).not.toBe(-1)

	return text.slice(start, end)
}

describe('the first-change tutorial', () => {
	it('is in the scanned document set', () => {
		expect(all_documents()).toContain(TUTORIAL)
	})

	it.each(PATTERNS)('$heading walks its steps in order', ({ heading, next_heading, steps }) => {
		const text = section(read_document(TUTORIAL), heading, next_heading)
		const positions = steps.map((step) => text.indexOf(step))

		expect(positions).not.toContain(-1)
		expect(positions).toStrictEqual(positions.toSorted((left, right) => left - right))
	})

	it('keeps how the guide was verified in the maintainer record, not on the page', () => {
		expect(linked_paths(VERIFICATION_RECORD)).toContain(TUTORIAL)
		expect(read_document(TUTORIAL)).not.toContain(VERIFYING_HEADING)
	})

	it.each(ENTRY_DOCUMENTS)('%s links to the tutorial', (path) => {
		expect(linked_paths(path)).toContain(TUTORIAL)
	})

	it('carries a section that needs no GitHub', () => {
		expect(read_document(TUTORIAL)).toContain(LOCAL_HEADING)
	})

	it.each(LOCAL_ENTRY_DOCUMENTS)('%s links to the section that needs no GitHub', (path) => {
		expect(read_document(path)).toContain(LOCAL_ANCHOR)
	})

	it.each(LOCAL_GUIDE_LINKS)('the section that needs no GitHub links to %s', (link) => {
		expect(section(read_document(TUTORIAL), LOCAL_HEADING, LOCAL_NEXT_HEADING)).toContain(link)
	})

	it.each(LOCAL_GITIGNORE_COMMANDS)('the section that needs no GitHub names `%s`', (command) => {
		expect(section(read_document(TUTORIAL), LOCAL_HEADING, LOCAL_NEXT_HEADING)).toContain(command)
	})
})
