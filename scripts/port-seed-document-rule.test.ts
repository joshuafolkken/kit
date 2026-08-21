import { describe, expect, it } from 'vitest'
import { AI_DOCS, ENV_EXAMPLE, read_repo_file } from './ai-document-fixture'

// #823: `.cursorrules` claimed the dev server runs on `5173` "per `playwright.config.ts`" — a
// number that config stopped producing the moment a consumer set a seed. These two are read as
// instructions rather than prose, so a stale number in them sends the tool itself to the wrong
// port, and `josh sync` overwrites any local correction. They state the relationship instead and
// carry no number; the AI docs are deliberately not on this list, because their `PORT_SEED` row
// gives the unset default conditionally, which is the reader's only way to learn what a seed
// changes.
const PORT_FREE_INSTRUCTION_DOCS: ReadonlyArray<string> = [
	'.cursorrules',
	'prompts/testing-guide.md',
]
const PORT_LITERALS: ReadonlyArray<string> = ['5173', '4173']

// The `dev` script the docs recommend feeds Playwright's `webServer`, and vite moves to the next
// free port when the requested one is taken. Without `--strictPort` a busy port produces a server
// on a port nothing is waiting on — the silent drift the seed exists to remove — instead of the
// loud failure the same section promises one paragraph later.
const JOSH_COMMANDS_DOC = 'docs/josh-commands.md'
const STRICT_DEV_SCRIPT = '"dev": "vite dev --port $(pnpm josh port dev) --strictPort"'

// #818: `PORT_SEED` is what lets several kit projects run their servers on one machine, and a
// developer only learns it exists from these documents. The three AI docs are paired by the Doc
// Sync Rules, so a variable described in one and missing from another leaves two of the three
// tools unable to explain it — and the env sample is where a new project copies its `.env` from.
const PORT_SEED_KEY = 'PORT_SEED'

// The no-fallback guarantee is the part that is easy to drop when the row is reworded, and it is
// the whole reason the variable is safe: a silent default would put two projects back on one port.
// #820: the docs promised `.env` while only `josh port` read it, so the two answered a consumer's
// `preview` script and its E2E suite with different ports. Naming both readers is what keeps the
// documented location and the implemented one from drifting apart again.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'| `PORT_SEED`',
	'An invalid value is a hard error, never a silent fall back to the shared default',
	'a busy port still fails loudly with no retry on another port',
	'`josh port` and `playwright.config.ts` both read the seed from `.env`',
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
		expect(read_repo_file(JOSH_COMMANDS_DOC)).toContain('### `josh port`')
	})

	it.each(PORT_FREE_INSTRUCTION_DOCS)('pins no port number in %s', (document_name) => {
		const content = read_repo_file(document_name)

		for (const literal of PORT_LITERALS) expect(content).not.toContain(literal)
	})

	it('recommends a dev script that fails on a busy port', () => {
		expect(read_repo_file(JOSH_COMMANDS_DOC)).toContain(STRICT_DEV_SCRIPT)
	})
})
