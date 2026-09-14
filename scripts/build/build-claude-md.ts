#!/usr/bin/env tsx
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { init_logic } from '#scripts/init/init-logic'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const SOURCE_CLAUDE_MD = path.join(REPO_ROOT, 'CLAUDE.md')
const DIST_CLAUDE_MD = path.join(REPO_ROOT, 'dist', 'CLAUDE.md')

// Read kit's own CLAUDE.md and apply the distribution path transform. kit's source keeps relative
// paths so it resolves inside the kit repository; the published copy rewrites them so every backtick
// reference resolves in a consumer too (joshuafolkken/kit#1878). Pure — the guard test asserts the
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

	return DIST_CLAUDE_MD
}

function main(): void {
	console.info(`  ✔ ${build_claude_md()} built`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export {
	build_claude_md,
	generate_distributed_claude_md,
	SOURCE_CLAUDE_MD,
	DIST_CLAUDE_MD,
	REPO_ROOT,
}
