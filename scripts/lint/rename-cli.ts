#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format_edited_payload } from '#scripts/hooks/format-edited-file'
import { rename_identifier, type RenameRequest, type TypeScriptApi } from './rename-identifier'

// `josh rename <old> <new> [--import <old-specifier> <new-specifier>] <file...>` — one identifier, and
// the import specifier it moved with, renamed across files in one call (joshuafolkken/kit#5236), where
// a lane would otherwise spend one Read and one Edit per file.
//
// **All or nothing**: a file the rename would not touch is named and nothing is written, since a path
// passed by mistake means the file list is not the one the caller thinks it is. Each written file is
// then formatted the way the edit hook formats an edited one — a Bash write gets no hook.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const IMPORT_FLAG = '--import'
const SPECIFIER_COUNT = 2
// What the TypeScript parser reads whole; a `.svelte` file's markup would be parsed as script.
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
])
const IDENTIFIER = /^[$A-Z_a-z][\w$]*$/u
const USAGE = `Usage: josh rename <old-identifier> <new-identifier> [${IMPORT_FLAG} <old-specifier> <new-specifier>] <file...>`

interface RenameArguments {
	request: RenameRequest
	files: ReadonlyArray<string>
}

interface FileRename {
	file: string
	text: string
	count: number
}

type Formatter = (files: ReadonlyArray<string>) => Promise<void>

interface SplitArguments {
	specifier: RenameRequest['specifier']
	rest: ReadonlyArray<string>
}

function split_import(argv: ReadonlyArray<string>): SplitArguments | undefined {
	const at = argv.indexOf(IMPORT_FLAG)

	if (at === -1) return { specifier: undefined, rest: argv }
	const [from, to] = argv.slice(at + 1, at + 1 + SPECIFIER_COUNT)
	if (from === undefined || to === undefined) return undefined

	return { specifier: [from, to], rest: argv.toSpliced(at, 1 + SPECIFIER_COUNT) }
}

function arguments_of(split: SplitArguments): RenameArguments | undefined {
	const [old_name = '', new_name = '', ...files] = split.rest

	if (!IDENTIFIER.test(old_name) || !IDENTIFIER.test(new_name)) return undefined

	return { request: { old_name, new_name, specifier: split.specifier }, files }
}

function parse(argv: ReadonlyArray<string>): RenameArguments | undefined {
	const split = split_import(argv)
	const parsed = split === undefined ? undefined : arguments_of(split)

	return parsed?.files.length === 0 ? undefined : parsed
}

function refuse(reason: string, files: ReadonlyArray<string>): number {
	console.error(`josh rename: ${reason}: ${files.join(', ')} — nothing was written`)

	return FAILURE_EXIT_CODE
}

function rename_all(api: TypeScriptApi, parsed: RenameArguments): ReadonlyArray<FileRename> {
	return parsed.files.map((file) => ({
		file,
		...rename_identifier.rewrite(api, file, readFileSync(file, 'utf8'), parsed.request),
	}))
}

async function write_all(
	renames: ReadonlyArray<FileRename>,
	formatter: Formatter,
): Promise<number> {
	for (const rename of renames) {
		writeFileSync(rename.file, rename.text)
		console.info(`${rename.file}: ${String(rename.count)}`)
	}

	await formatter(renames.map((rename) => rename.file))

	return 0
}

async function apply(
	api: TypeScriptApi,
	parsed: RenameArguments,
	formatter: Formatter,
): Promise<number> {
	const missing = parsed.files.filter((file) => !existsSync(file))
	if (missing.length > 0) return refuse('no such file', missing)
	const unparsed = parsed.files.filter((file) => !SCRIPT_EXTENSIONS.has(path.extname(file)))
	if (unparsed.length > 0) return refuse('not a TypeScript or JavaScript file', unparsed)
	const renames = rename_all(api, parsed)
	const untouched = renames.filter((rename) => rename.count === 0).map((rename) => rename.file)
	if (untouched.length > 0) return refuse('no replacement', untouched)

	return await write_all(renames, formatter)
}

// The edit hook's own formatter, one file at a time: each run rewrites the file the next may import.
async function format_files(files: ReadonlyArray<string>): Promise<void> {
	for (const file of files) {
		const payload = JSON.stringify({ tool_input: { file_path: path.resolve(file) } })
		// eslint-disable-next-line no-await-in-loop -- formatters rewrite files the next run reads
		const diagnostics = await format_edited_payload(payload, process.cwd())

		if (diagnostics !== undefined) console.info(diagnostics)
	}
}

async function run(
	argv: ReadonlyArray<string>,
	api: TypeScriptApi,
	formatter: Formatter = format_files,
): Promise<number> {
	const parsed = parse(argv)

	if (parsed !== undefined) return await apply(api, parsed, formatter)
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	const typescript = await import('typescript')

	process.exitCode = await run(argv, typescript.default)
}

const rename_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { rename_cli }
