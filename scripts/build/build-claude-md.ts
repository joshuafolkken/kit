#!/usr/bin/env tsx
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { init_logic } from '#scripts/init/init-logic'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const DIST_ROOT = path.join(REPO_ROOT, 'dist')
const BASIC_CLAUDE_FILENAME = 'CLAUDE.basic.md'
const SOURCE_CLAUDE_MD = path.join(REPO_ROOT, 'CLAUDE.md')
const DIST_CLAUDE_MD = path.join(DIST_ROOT, 'CLAUDE.md')
const SOURCE_BASIC_CLAUDE_MD = path.join(REPO_ROOT, 'templates', BASIC_CLAUDE_FILENAME)
// A basic project's `CLAUDE.md` imports the rules from dist/. An older one imports them under the
// profile's old name until `josh init` is re-run and migrates that import, so the same rules ship
// under both names.
const DIST_BASIC_CLAUDE_MDS: ReadonlyArray<string> = [
	path.join(DIST_ROOT, BASIC_CLAUDE_FILENAME),
	path.join(DIST_ROOT, 'CLAUDE.static.md'),
]

// Read kit's own CLAUDE.md and apply the distribution path transform. kit's source keeps relative
// paths so it resolves inside the kit repository; the published copy rewrites them so every backtick
// reference resolves in a consumer too. Pure — the guard test asserts the
// result carries no reference a consumer cannot open.
function generate_distributed_claude_md(): string {
	return init_logic.transform_distributed_paths(readFileSync(SOURCE_CLAUDE_MD, 'utf8'))
}

// Ship the transformed CLAUDE.md from dist/, like every other build artifact: gitignored, but carried
// into the package by the `files` array, so a consumer imports it at
// node_modules/@joshuafolkken/kit/dist/CLAUDE.md.
function build_claude_md(): string {
	mkdirSync(path.dirname(DIST_CLAUDE_MD), { recursive: true })
	writeFileSync(DIST_CLAUDE_MD, generate_distributed_claude_md())
	const basic_rules = readFileSync(SOURCE_BASIC_CLAUDE_MD, 'utf8')

	for (const destination of DIST_BASIC_CLAUDE_MDS) writeFileSync(destination, basic_rules)

	return DIST_CLAUDE_MD
}

function main(): void {
	console.info(`  ✔ ${build_claude_md()} built`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export {
	build_claude_md,
	DIST_BASIC_CLAUDE_MDS,
	generate_distributed_claude_md,
	SOURCE_CLAUDE_MD,
	DIST_CLAUDE_MD,
	REPO_ROOT,
}
