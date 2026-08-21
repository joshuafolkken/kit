import { describe, expect, it } from 'vitest'
import { AI_DOCS, ENV_EXAMPLE, read_repo_file } from './ai-document-fixture'

// #818: `PORT_SEED` is what lets several kit projects run their servers on one machine, and a
// developer only learns it exists from these documents. The three AI docs are paired by the Doc
// Sync Rules, so a variable described in one and missing from another leaves two of the three
// tools unable to explain it — and the env sample is where a new project copies its `.env` from.
const PORT_SEED_KEY = 'PORT_SEED'

// The no-fallback guarantee is the part that is easy to drop when the row is reworded, and it is
// the whole reason the variable is safe: a silent default would put two projects back on one port.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'| `PORT_SEED`',
	'An invalid value is a hard error, never a silent fall back to the shared default',
	'a busy port still fails loudly with no retry on another port',
]

describe('PORT_SEED documentation', () => {
	it.each(AI_DOCS)('documents the variable in %s', (document_name) => {
		const content = read_repo_file(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('offers the variable in the env sample a new project copies', () => {
		expect(read_repo_file(ENV_EXAMPLE)).toContain(`${PORT_SEED_KEY}=`)
	})

	it('documents the command that prints the resolved port', () => {
		expect(read_repo_file('docs/josh-commands.md')).toContain('### `josh port`')
	})
})
