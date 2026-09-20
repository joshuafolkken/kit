import { read_repo_file, routing_documents } from '#scripts/document/ai-document-fixture'
import { single_source, type SingleSourceRule } from '#scripts/document/single-source'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2188. The two commands that lay the foundation epic #2166 trims the entry read on
// — `run:next` (the next step, computed from run state) and `doc:read` (a Bash-cap-safe whole-document
// read) — guarded off the command registration and `docs/josh-commands.md`, the command's own
// reference. It also exercises the single-source framework this issue ships (`single-source.ts`)
// against the real corpus, so the framework a later child pins each prose move with is proven to run
// on the documents rather than only on synthetic inputs.

const DOCS = 'docs/josh-commands.md'

const NEXT_COMMAND = 'run:next'
const NEXT_ALIAS = 'rn'
const NEXT_SCRIPT = 'scripts/run/run-next-cli.ts'
const READ_COMMAND = 'doc:read'
const READ_ALIAS = 'dcr'
const READ_SCRIPT = 'scripts/document/document-read-cli.ts'

const DOC_MARKERS: ReadonlyArray<string> = ['### `josh run:next`', '### `josh doc:read`']

// A phrase unique to the `doc:read` reference — the framework asserts it lives in the one document and
// is not pasted into any other routing document, which is exactly the check a later child of #2166
// will run over the prose it moves into a command's help.
const DOC_READ_RULE: SingleSourceRule = {
	marker: 'this never emits the over-cap document through the shell',
	canonical: DOCS,
}

describe.each([
	[NEXT_COMMAND, NEXT_ALIAS, NEXT_SCRIPT],
	[READ_COMMAND, READ_ALIAS, READ_SCRIPT],
])('%s is registered', (command, alias, script) => {
	it('runs the script it is documented as running', () => {
		expect(COMMAND_MAP[command]?.script).toBe(script)
	})

	it('has the short alias the documents print', () => {
		expect(ALIASES[alias]).toBe(command)
	})
})

describe(`${DOCS} documents both commands`, () => {
	it.each(DOC_MARKERS)('mentions: %j', (marker) => {
		expect(read_repo_file(DOCS)).toContain(marker)
	})
})

describe('the single-source framework runs on the real corpus', () => {
	it('finds the doc:read explanation single-sourced to its own reference', () => {
		const documents = routing_documents()
		const is_held = single_source.is_single_sourced(DOC_READ_RULE, documents, read_repo_file)

		expect(is_held).toBe(true)
	})
})
