import { existsSync, readFileSync } from 'node:fs'
import { command_reference_line_budget } from '#scripts/document/command-reference-line-budget'

// The files a plan's sources derive, which change with them though the plan does not name them
// (joshuafolkken/kit#8859): a command definition file's entries render into the reference pages whose
// `<!-- usage: <command> -->` span names one of them, and into the catalog, both by `josh command:derive`.
// #8798 planned `josh-commands-epic.ts` without `docs/josh-commands-backlog.md` and widened its plan
// after review. `lane:plan` counts these in its size estimate and prints them.
//
// Registries and fixtures were checked for the same treatment and left out: an alias, a completion entry
// or a test fixture moves only when a command is added or renamed, which the file path alone does not tell.

type ReadText = (path: string) => string | undefined

const { COMMAND_CATALOG_DOC, COMMAND_REFERENCE_DOCS } = command_reference_line_budget

// The command map and its per-area definition files; a test file beside them defines no command.
const DEFINITION_FILE = /^scripts\/josh\/josh-command(?:s-[\w-]+|-map)\.ts$/u
// A command entry is the one key at one tab that opens an object (`\tlint: {`, `\t'run:observe': {`);
// the entry's own fields sit two tabs in.
const ENTRY_KEY = /^\t'?([a-z][\w:-]*)'?: \{$/gmu

function read_text(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

function command_names(text: string): Array<string> {
	return [...text.matchAll(ENTRY_KEY)].map((match) => match[1] ?? '')
}

function usage_marker(name: string): string {
	return `<!-- usage: ${name} -->`
}

function pages_for(names: ReadonlyArray<string>, read: ReadText): Array<string> {
	return COMMAND_REFERENCE_DOCS.filter((page) => {
		const text = read(page) ?? ''

		return names.some((name) => text.includes(usage_marker(name)))
	})
}

function derived_of(path: string, read: ReadText): Array<string> {
	if (!DEFINITION_FILE.test(path)) return []
	const names = command_names(read(path) ?? '')

	return names.length === 0 ? [] : [...pages_for(names, read), COMMAND_CATALOG_DOC]
}

// The files `paths` derive that `paths` does not already name, each once.
function of(paths: ReadonlyArray<string>, read: ReadText = read_text): Array<string> {
	const planned = new Set(paths)
	const derived = new Set(paths.flatMap((path) => derived_of(path, read)))

	return [...derived].filter((path) => !planned.has(path))
}

const derived_paths = { command_names, of }

export { derived_paths }
export type { ReadText }
