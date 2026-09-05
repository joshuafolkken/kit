import { describe, expect, it } from 'vitest'
import { CANONICAL_DOC, read_repo_file, read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1425: the line limit was reported only after the writing was done, so the
// splitting it forced was rework rather than design. The mechanism is `pnpm josh lines`; the rule that
// makes a run consult it is one sentence in Code Change Rules Step 0, and without that sentence the
// command exists and is never called. Each marker below is one place the rule has to be readable from.

const REPORT_FORMAT_TOPIC = 'prompts/collaboration-workflow/report-format.md'
const COMMAND_DOC = 'docs/josh-commands.md'

const SECTION_POINTER = '行数予算は編集前に読む'

// The resident half is a trigger plus a pointer, per the residency rule: the command to run, the one
// thing that must then be written, and where the procedure is. Anything more belongs at the pointer.
const RESIDENT_MARKERS: ReadonlyArray<string> = [
	'pnpm josh lines',
	'splitting plan',
	SECTION_POINTER,
]

// The procedure's single source: when it fires, what the declaration has to carry, and the two things
// a reader gets wrong without being told — that the count is code lines rather than physical ones, and
// that the report never replaces the limit.
const TOPIC_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_POINTER}`,
	'pnpm josh lines <path>',
	'wc -l',
	'joshuafolkken/kit#1070',
	'joshuafolkken/kit#1425',
]

// The command reference: what it prints, that it never fails on a large file, and the one number a
// reader will otherwise assume — where "near the limit" starts.
const COMMAND_DOC_MARKERS: ReadonlyArray<string> = [
	'### `josh lines`',
	'near from',
	'never fails on a large file',
]

describe(`${CANONICAL_DOC} — Step 0 carries the trigger`, () => {
	const content = read_unwrapped(CANONICAL_DOC)

	it.each(RESIDENT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${REPORT_FORMAT_TOPIC} — the procedure is defined`, () => {
	const content = read_repo_file(REPORT_FORMAT_TOPIC)

	it.each(TOPIC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${COMMAND_DOC} — the command is documented`, () => {
	const content = read_repo_file(COMMAND_DOC)

	it.each(COMMAND_DOC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
