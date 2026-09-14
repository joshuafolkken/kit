import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { import_closure, SCRIPTS_DIR } from './import-closure-fixture'

// The pack boundary (joshuafolkken/kit#1997): the published npm package and the `kit` plugin must
// carry what a consumer runs — every distributed command's entry script and its static import
// closure — and none of what only measures kit's own development: the report modules under `time/`
// and `cost/`, the `eval` suite, `docs/eval.md`, and the `diag` skill. The list is read from an
// actual `pnpm pack --dry-run`, so an exclusion pattern that stops matching is caught here rather
// than shipping. `--config.ignore-scripts=true` skips the prepack build and its network range check;
// neither changes which files the `files` field selects.

const REPO_ROOT = path.dirname(SCRIPTS_DIR)

// Kit-only measurement code and the diag skill: nothing under these may reach the published package.
const EXCLUDED_PREFIXES = [
	'scripts/eval/',
	'scripts/time/',
	'scripts/cost/',
	'.claude/skills/diag/',
]
const EXCLUDED_FILES = new Set(['docs/eval.md'])

interface PackedEntry {
	path: string
}

interface PackReport {
	files?: Array<PackedEntry>
}

function packed_files(): Set<string> {
	const raw = execFileSync(
		'pnpm',
		['pack', '--dry-run', '--json', '--config.ignore-scripts=true'],
		{ cwd: REPO_ROOT, encoding: 'utf8' },
	)
	const parsed = JSON.parse(raw) as PackReport | Array<PackReport>
	const report = Array.isArray(parsed) ? parsed[0] : parsed

	return new Set((report?.files ?? []).map((entry) => entry.path))
}

// Every distributed (not kit-only) command's entry script, absolute, deduped across shared scripts.
function distributed_seeds(): Array<string> {
	const scripts = Object.values(COMMAND_MAP)
		.filter((entry) => entry.is_kit_only !== true)
		.map((entry) => entry.script)
		.filter((script): script is string => typeof script === 'string')
		.map((script) => path.join(REPO_ROOT, script))

	return [...new Set(scripts)]
}

describe('the published package boundary', () => {
	const packed = packed_files()

	it('ships no kit-only measurement report, eval module, or diag skill', () => {
		const leaked = [...packed].filter(
			(file) =>
				EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)) || EXCLUDED_FILES.has(file),
		)

		expect(leaked).toEqual([])
	})

	it('still ships the runtime analysis the hooks, guards and cost --over rely on', () => {
		expect(packed.has('scripts/cost-runtime/cost-cli.ts')).toBe(true)
		expect([...packed].some((file) => file.startsWith('scripts/time-runtime/'))).toBe(true)
	})

	it('ships every distributed command script and its whole static import closure', () => {
		const missing = [...import_closure.closure(distributed_seeds())]
			.filter((file) => existsSync(file))
			.map((file) => path.relative(REPO_ROOT, file))
			.filter((relative) => !packed.has(relative))

		expect(missing).toEqual([])
	})
})
