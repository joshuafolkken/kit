import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { HOOK_BUNDLES } from './build-hooks'
import { import_closure, SCRIPTS_DIR } from './import-closure-fixture'

// The pack boundary (joshuafolkken/kit#1997): the published npm package and the `kit` plugin must
// carry what a consumer runs — every distributed command's entry script and its static import
// closure — and none of what only measures kit's own development: the report modules under `time/`
// and `cost/`, the `eval` suite and `docs/maintainers/eval.md`. The list is read from an
// actual `pnpm pack --dry-run`, so an exclusion pattern that stops matching is caught here rather
// than shipping. `--config.ignore-scripts=true` skips the prepack build and its network range check;
// neither changes which files the `files` field selects.

const REPO_ROOT = path.dirname(SCRIPTS_DIR)

// Kit-only code and data: nothing under these may reach the published package.
const EXCLUDED_PREFIXES = [
	'scripts/eval/',
	'scripts/time/',
	'scripts/cost/',
	'scripts/retrospective/',
	'scripts/dogfood/',
	'evals/',
]
const EXCLUDED_FILES = new Set(['docs/maintainers/eval.md'])

// Runtime entries a consumer reaches by file path rather than by a static import
// (joshuafolkken/kit#2899): `init` writes `fix-gh-packages.ts` into the consumer's `prepare`, and the lane
// supervisor spawns its CLI by URL. The hook sources (the Codex adapter's fallback included) are
// seeded from `HOOK_BUNDLES`.
const PATH_LAUNCHED_ENTRIES = [
	'scripts/gh/fix-gh-packages.ts',
	'scripts/lane/openai-lane-supervisor-cli.ts',
]

// Shipped although no consumer entry reaches them: kit's own build and release entries, which run
// from kit's checkout (`pnpm build`, CI workflows). Every other unreachable module is kit-internal
// and must be excluded by the `files` field.
const SHIPPED_UNREACHABLE = new Set([
	'scripts/build/build-bin.ts',
	'scripts/build/build-claude-md.ts',
	'scripts/build/build-codex-hooks.ts',
	'scripts/agent/codex-hooks.ts',
	'scripts/build/build-hooks.ts',
	'scripts/build/build-library.ts',
	'scripts/build/hook-bundle-stamp.ts',
	'scripts/build/build.ts',
	'scripts/managed-marker/index.ts',
	'scripts/self-sync-guard/index.ts',
	'scripts/version/index.ts',
	'scripts/version/effective-upstream.ts',
	'scripts/package/verify-optional-eslint-install.ts',
	'scripts/release/github-release.ts',
	'scripts/release/github-release-cli.ts',
	'scripts/release/publish-tag.ts',
	'scripts/release/publish-tag-cli.ts',
])

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

// Every file a consumer can execute: the distributed commands, the bin entry, each hook bundle's
// source and the path-launched entries.
function consumer_seeds(): Array<string> {
	const sources = [
		'scripts/josh/josh.ts',
		...HOOK_BUNDLES.map((bundle) => bundle.source),
		...PATH_LAUNCHED_ENTRIES,
	]

	return [...distributed_seeds(), ...sources.map((source) => path.join(REPO_ROOT, source))]
}

function reachable_files(): Set<string> {
	const closure = import_closure.closure(consumer_seeds())

	return new Set([...closure].map((file) => path.relative(REPO_ROOT, file)))
}

describe('the published package boundary', () => {
	const packed = packed_files()

	it('ships no kit-only measurement report or eval module', () => {
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

	it('ships both Codex project configuration files', () => {
		expect(packed.has('.codex/config.toml')).toBe(true)
		expect(packed.has('.codex/hooks.json')).toBe(true)
	})

	it('ships every consumer entry and its whole static import closure', () => {
		const missing = [...import_closure.closure(consumer_seeds())]
			.filter((file) => existsSync(file))
			.map((file) => path.relative(REPO_ROOT, file))
			.filter((relative) => !packed.has(relative))

		expect(missing).toEqual([])
	})
})

describe('the published package carries nothing kit-internal', () => {
	const packed = packed_files()

	it('ships no scripts module that no consumer entry reaches', () => {
		const reachable = reachable_files()
		const unreachable = [...packed].filter(
			(file) =>
				file.startsWith('scripts/') &&
				file.endsWith('.ts') &&
				!reachable.has(file) &&
				!SHIPPED_UNREACHABLE.has(file),
		)

		expect(unreachable).toEqual([])
	})

	it('ships no test snapshot or golden transcript', () => {
		const leaked = [...packed].filter(
			(file) => file.includes('/__snapshots__/') || file.endsWith('.golden.txt'),
		)

		expect(leaked).toEqual([])
	})
})
