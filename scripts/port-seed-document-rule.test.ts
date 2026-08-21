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
//
// #825: the rest of each line is load-bearing for the same reason. `pnpm` writes any install log
// to **stdout**, and adds `[ELIFECYCLE]` there too wherever `pnpm josh` resolves to `pnpm run
// josh`, so a `$(pnpm josh port dev)` substitution hands that prose to `--port`; and an inline
// substitution that fails does not stop the server it feeds, so the resolver's error has to become
// the script's exit status through an assignment. These are the shapes a consumer copies, which
// makes the doc the only place the guarantee can be enforced.
const JOSH_COMMANDS_DOC = 'docs/josh-commands.md'
const RECOMMENDED_PORT_SCRIPTS: ReadonlyArray<string> = [
	'"dev": "DEV_PORT=$(josh port dev) && vite dev --port $DEV_PORT --strictPort"',
	'"preview": "PREVIEW_PORT=$(josh port preview) && wrangler dev --port $PREVIEW_PORT"',
	'"preview:stop": "PREVIEW_PORT=$(josh port preview) && kill-port $PREVIEW_PORT"',
]

// The retired shapes are named literally rather than by a `pnpm josh port` search, because the
// same section has to keep quoting the broken form to explain why it was dropped. Both halves of
// the fix are pinned: dropping the `pnpm` wrapper, and assigning before use. An inline
// `$(josh port dev)` fixes only the first — the substitution is clean, but its failure still does
// not stop the server it feeds — so it is retired here as well, and the recommended shapes alone
// would not catch its return.
const RETIRED_PORT_SCRIPTS: ReadonlyArray<string> = [
	'"dev": "vite dev --port $(pnpm josh port dev)',
	'"preview": "wrangler dev --port $(pnpm josh port preview)',
	'"preview:stop": "kill-port $(pnpm josh port preview)',
	'"dev": "vite dev --port $(josh port dev)',
	'"preview": "wrangler dev --port $(josh port preview)',
	'"preview:stop": "kill-port $(josh port preview)',
]

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

	it.each(RECOMMENDED_PORT_SCRIPTS)('recommends the server script %s', (script_line) => {
		expect(read_repo_file(JOSH_COMMANDS_DOC)).toContain(script_line)
	})

	it.each(RETIRED_PORT_SCRIPTS)('no longer recommends the script %s', (script_line) => {
		expect(read_repo_file(JOSH_COMMANDS_DOC)).not.toContain(script_line)
	})
})
