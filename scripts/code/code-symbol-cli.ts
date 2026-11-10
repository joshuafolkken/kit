#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { capped_output } from '#scripts/document/capped-print'
import { document_section } from '#scripts/document/document-section'
import { working_tree } from '#scripts/init/working-tree'
import { code_symbol, type Declaration, type TypeScriptApi } from './code-symbol'

// `josh code:symbol` — the code counterpart of `doc:section`: one declaration read by name, so a run
// does not find it with `grep -n` and then guess its range for `sed -n`.

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const MAX_ARGUMENTS = 2
const SOURCE_PATTERNS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.mjs', '*.cjs']
// Untracked files count too, so a declaration written in this session is found before it is staged.
const LISTING_ARGUMENTS = ['ls-files', '--cached', '--others', '--exclude-standard']
const USAGE = [
	'Usage: josh code:symbol <file> <name>   print the declaration, comments included, numbered',
	'       josh code:symbol <name>          list where it is declared, as file:line',
	`Reads ${SOURCE_PATTERNS.join(' ')}; a Svelte <script> is not read.`,
].join('\n')

function matching(declarations: ReadonlyArray<Declaration>, name: string): Array<Declaration> {
	return declarations.filter((declaration) => declaration.name === name)
}

function report_missing(file: string, name: string, found: ReadonlyArray<Declaration>): number {
	const declared_names = new Set(found.map((declaration) => declaration.name))

	console.error(`No declaration named ${name} in ${file}. Declared there:`)

	for (const declared of declared_names) {
		console.error(`  ${declared}`)
	}

	return FAILURE_EXIT_CODE
}

function print_declaration(api: TypeScriptApi, file: string, name: string, root: string): number {
	const text = document_section.read_optional(path.resolve(root, file))

	if (text === undefined) {
		console.error(`Cannot read ${file}`)

		return FAILURE_EXIT_CODE
	}

	const found = code_symbol.declarations(api, file, text)
	const matched = matching(found, name)

	if (matched.length === 0) return report_missing(file, name, found)
	capped_output.capped_print(
		matched.map((item) => code_symbol.numbered(item)).join('\n\n'),
		name,
		root,
	)

	return 0
}

// The text is searched before it is parsed, so only files that spell the name pay for a parse.
function sites_in(api: TypeScriptApi, file: string, name: string, root: string): Array<string> {
	const text = document_section.read_optional(path.join(root, file))

	if (text?.includes(name) !== true) return []

	return matching(code_symbol.declarations(api, file, text), name).map(
		(declaration) => `${file}:${String(declaration.line)}`,
	)
}

function list_declarations(api: TypeScriptApi, name: string, root: string): number {
	const files = working_tree.listing([...LISTING_ARGUMENTS, ...SOURCE_PATTERNS], root)
	const sites = files.flatMap((file) => sites_in(api, file, name, root))

	if (sites.length === 0) {
		console.error(`No declaration named ${name} in the repository`)

		return FAILURE_EXIT_CODE
	}

	capped_output.capped_print(sites.join('\n'), name, root)

	return 0
}

function run(
	argv: ReadonlyArray<string>,
	api: TypeScriptApi,
	root: string = process.cwd(),
): number {
	const [first, second] = argv

	if (first === undefined || argv.length > MAX_ARGUMENTS) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return second === undefined
		? list_declarations(api, first, root)
		: print_declaration(api, first, second, root)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	const typescript = await import('typescript')

	process.exitCode = run(argv, typescript.default)
}

const code_symbol_cli = { FAILURE_EXIT_CODE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { code_symbol_cli }
