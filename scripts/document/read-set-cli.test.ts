import { describe, expect, it, vi } from 'vitest'
import { document_section_cli } from './document-section-cli'
import { read_set_cli } from './read-set-cli'

// joshuafolkken/kit#1776. Both commands are read at the same place — the entry point — so both are
// asserted here: the one that fetches a section, and the one that says what the entry costs.

const ROOT = process.cwd()
const SUCCESS = 0
const BACKLOGRUN_DOC = 'backlogrun.md'
const PROGRESS_DOC = 'backlogrun-progress.md'
const HAND_OFF = 'The hand-off'
const BACKLOGRUN = 'backlogrun'
const LANE_CHILD = 'lane-child'
const NO_SUCH_DOC = 'no-such-doc.md'
const FAILURE = 1
const MISTYPED = 'not-an-entry'

interface Captured {
	code: number
	out: string
	err: string
}

function captured(act: () => number): Captured {
	const out: Array<string> = []
	const error: Array<string> = []
	const info = vi.spyOn(console, 'info').mockImplementation((line) => {
		out.push(String(line))
	})
	const failure = vi.spyOn(console, 'error').mockImplementation((line) => {
		error.push(String(line))
	})
	const code = act()

	info.mockRestore()
	failure.mockRestore()

	return { code, out: out.join('\n'), err: error.join('\n') }
}

describe('josh doc:section', () => {
	it('prints the named section of a sibling workflow document', () => {
		const { code, out } = captured(() => document_section_cli.run([PROGRESS_DOC, HAND_OFF]))

		expect(code).toBe(SUCCESS)
		expect(out).toContain(`## ${HAND_OFF}`)
		expect(out).not.toContain('## Waiting, and never waiting forever')
	})

	it('refuses a heading the document does not have, and lists what it does', () => {
		const { code, err } = captured(() =>
			document_section_cli.run([PROGRESS_DOC, 'No Such Heading']),
		)

		expect(code).toBe(document_section_cli.FAILURE_EXIT_CODE)
		expect(err).toContain(HAND_OFF)
	})

	it('refuses a file it cannot read, naming the path it tried', () => {
		const { code, err } = captured(() => document_section_cli.run([NO_SUCH_DOC, 'Anything']))

		expect(code).toBe(document_section_cli.FAILURE_EXIT_CODE)
		expect(err).toContain(NO_SUCH_DOC)
	})

	it('prints the usage when either argument is missing', () => {
		const { code, err } = captured(() => document_section_cli.run([BACKLOGRUN_DOC]))

		expect(code).toBe(document_section_cli.FAILURE_EXIT_CODE)
		expect(err).toBe(document_section_cli.USAGE)
	})

	it('resolves a bare document name inside the workflow skill directory', () => {
		expect(document_section_cli.resolve_document(BACKLOGRUN_DOC, ROOT)).toContain(
			`.claude/skills/workflow-commands/${BACKLOGRUN_DOC}`,
		)
	})
})

// An unrecognized keyword used to produce a complete report with a saving of zero and exit 0, so a
// typo answered "nothing to save" rather than "no such entry".
describe('josh read:set — what it refuses', () => {
	it('refuses an entry the table does not carry, and lists the ones it does', () => {
		const { code, err } = captured(() => read_set_cli.run([MISTYPED], ROOT))

		expect(code).toBe(FAILURE)
		expect(err).toContain('Known entries:')
		expect(err).toContain(BACKLOGRUN)
	})
})

describe('josh read:set', () => {
	it('reports both figures and the saving for the entry it was given', () => {
		const { code, out } = captured(() => read_set_cli.run([BACKLOGRUN], ROOT))

		expect(code).toBe(SUCCESS)
		expect(out).toContain(`entry: ${BACKLOGRUN}`)
		expect(out).toContain(read_set_cli.WHOLE_LABEL)
		expect(out).toContain(read_set_cli.SCOPED_LABEL)
		expect(out).toContain('saved by reading sections:')
	})

	it('reports every entry point when none is named', () => {
		const { out } = captured(() => read_set_cli.run([], ROOT))

		expect(out).toContain('entry: kickoff')
		expect(out).toContain('entry: backlogrun')
	})

	it('emits one JSON array under --json', () => {
		const { out } = captured(() => read_set_cli.run([BACKLOGRUN, read_set_cli.JSON_FLAG], ROOT))

		expect(JSON.parse(out)).toHaveLength(1)
	})

	// A saving reported as a share has to be a share of something, so a zero read is 0% rather than a
	// division by zero reported as a number.
	it('reports no saving where there is nothing to read', () => {
		const empty = { bytes: 0, tokens: 0 }

		expect(
			read_set_cli.saved_percent({
				bash_output_cap: 0,
				entry: 'none',
				files: [],
				point_of_use: [],
				sections: [],
				whole: empty,
				scoped: empty,
			}),
		).toBe(SUCCESS)
	})
})

// The dispatched lane child is a synthetic entry, not a table keyword, so the CLI has to offer it and
// report it (joshuafolkken/kit#2021).
describe('josh read:set — the lane-child entry', () => {
	it('reports the synthetic lane-child entry with its total-read figure and note', () => {
		const { code, out } = captured(() => read_set_cli.run([LANE_CHILD], ROOT))

		expect(code).toBe(SUCCESS)
		expect(out).toContain(`entry: ${LANE_CHILD}`)
		expect(out).toContain(read_set_cli.TOTAL_READ_LABEL)
		expect(out).toContain('JOSH_LANE_CHILD')
	})

	it('lists lane-child among the entries it offers and never refuses it', () => {
		expect(read_set_cli.known_entries(ROOT)).toContain(LANE_CHILD)
		expect(captured(() => read_set_cli.run([LANE_CHILD], ROOT)).code).toBe(SUCCESS)
	})
})
