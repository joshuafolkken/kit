#!/usr/bin/env tsx
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { ui_routes } from './ui-routes'

// `josh ui:routes [--staged]` — list the screenshot-target routes the current change touches
// (joshuafolkken/kit#2182).
//
// The derivation lives in `ui-routes.ts`; this file is the I/O around it: read the changed paths
// (the branch diff, or the staged diff with `--staged`), and resolve a shared component to the routes
// that import it by scanning `src/routes`. A change that derives no route prints that plainly rather
// than guessing, matching the `verify-ui` skill's "do not guess".

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh ui:routes [--staged]'
const STAGED_FLAG = '--staged'
const ROUTES_DIR = 'src/routes'
const PATH_SEPARATOR = '/'
const FAILURE_EXIT_CODE = 1
const NO_ROUTES_MESSAGE =
	'no route derived from this change — name the screen to capture, do not guess'

interface RouteFile {
	absolute: string
	relative: string
}

type ImporterFinder = (component: string) => Array<string>

// `undefined` on an unknown flag rather than a default: a misspelled flag makes the invocation
// unreadable, and an unreadable invocation is refused, not answered.
function parse_staged(argv: ReadonlyArray<string>): boolean | undefined {
	if (argv.some((argument) => argument !== STAGED_FLAG)) return undefined

	return argv.includes(STAGED_FLAG)
}

function base_name(file: string): string {
	return file.slice(file.lastIndexOf(PATH_SEPARATOR) + 1)
}

function to_route_file(root: string, directory: string, name: string): RouteFile {
	const absolute = path.join(directory, name)

	return { absolute, relative: path.relative(root, absolute).split(path.sep).join(PATH_SEPARATOR) }
}

function route_files(root: string): Array<RouteFile> {
	try {
		return readdirSync(path.join(root, ROUTES_DIR), { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => to_route_file(root, entry.parentPath, entry.name))
	} catch {
		return []
	}
}

function read_text(file: string): string {
	try {
		return readFileSync(file, 'utf8')
	} catch {
		return ''
	}
}

// A route file imports the component when its source names the component's file — the import
// statement carries the `.svelte` path. Over-inclusion is the safe direction for a candidate list: a
// spare route is dropped by the reader, a missing one is never captured.
function build_find_importers(files: ReadonlyArray<RouteFile>): ImporterFinder {
	return (component) =>
		files
			.filter((file) => read_text(file.absolute).includes(base_name(component)))
			.map((file) => file.relative)
}

function print_routes(routes: ReadonlyArray<string>): void {
	if (routes.length === 0) {
		console.info(NO_ROUTES_MESSAGE)

		return
	}

	for (const route of routes) console.info(route)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const is_staged = parse_staged(argv)

	if (is_staged === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const changed = await changed_paths.read_changed_paths(is_staged)
	const find_importers = build_find_importers(route_files(await git_command.repository_root()))

	print_routes(ui_routes.derive_routes(changed, find_importers))

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const ui_routes_cli = {
	build_find_importers,
	main,
	parse_staged,
	print_routes,
	route_files,
	run,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { ui_routes_cli }
