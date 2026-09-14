import { kit_only } from '#scripts/josh/kit-only'
import { describe, expect, it } from 'vitest'
import { all_documents, read_document } from './ai-document-fixture'
import { document_scan } from './document-scan'

// A distributed procedure document must not name a kit-only command as an execution step: a consumer
// reads these to run the workflow, and a kit-only command is refused there (joshuafolkken/kit#1988).
// The command reference under `docs/` is documentation, not a procedure — a kit-only command still
// gets its section there — so `docs/` is excluded and the workflow skills, prompts and CLAUDE.md are
// what this pins.
const PROCEDURE_DOCS: ReadonlyArray<string> = all_documents().filter(
	(path) => !path.startsWith('docs/'),
)

const KIT_ONLY_COMMANDS: ReadonlySet<string> = new Set(kit_only.command_names())

function kit_only_references(text: string): Array<string> {
	return document_scan.command_references(text).filter((name) => KIT_ONLY_COMMANDS.has(name))
}

describe('no distributed procedure document names a kit-only command', () => {
	it.each(PROCEDURE_DOCS)('%s names no kit-only command', (path) => {
		expect(kit_only_references(read_document(path))).toStrictEqual([])
	})

	// The guard is only worth keeping if it fails on the thing it exists to catch.
	it('flags a kit-only command named in a code span', () => {
		expect(kit_only_references('run `pnpm josh eval` first')).toStrictEqual(['eval'])
	})
})
