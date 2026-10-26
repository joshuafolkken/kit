import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it, onTestFinished } from 'vitest'
import { HOOK_BUNDLES, STAGING_PREFIX } from './build-hooks'
import { hook_bundle_stamp } from './hook-bundle-stamp'
import { import_closure, SCRIPTS_DIR } from './import-closure-fixture'

// The pack boundary (joshuafolkken/kit#1997): the published npm package and the `kit` plugin must
// carry what a consumer runs — every distributed command's entry script and its static import
// closure — and none of what only serves kit's own development: everything under `tools/`, the
// `evals/` data and `docs/maintainers/eval.md`. The list is read from an actual `pnpm pack --dry-run`,
// so a boundary that stops holding is caught here rather than shipping. `--config.ignore-scripts=true`
// skips the prepack build and its network range check; neither changes which files the `files` field
// selects.
//
// The boundary is a directory (joshuafolkken/kit#4149): kit-only code lives in `tools/`, so `files`
// names `scripts` whole and never excludes a file under it one by one.

const REPO_ROOT = path.dirname(SCRIPTS_DIR)

// Kit-only code and data: nothing under these may reach the published package.
const EXCLUDED_PREFIXES = ['tools/', 'evals/']
const EXCLUDED_FILES = new Set(['docs/maintainers/eval.md'])
// A per-file exclusion under `scripts/` — what the directory boundary replaces. The generic
// test-support patterns (`!**/*.test.ts` and the rest) are not under it.
const SCRIPTS_EXCLUSION_PREFIX = '!scripts/'
const { VERIFIED_NAME } = hook_bundle_stamp
const SHIPPED_HOOK = 'stop-guard.js'
const MANIFEST_NAME = 'package.json'
// `build-commands.test.ts` builds into a private `dist/` directory under this prefix (joshuafolkken/kit#5053).
const COMMANDS_TEST_PREFIX = '.commands-test-'
const SCRATCH_PREFIXES = [STAGING_PREFIX, COMMANDS_TEST_PREFIX]

interface PackageManifest {
	files?: Array<string>
}

// Runtime entries a consumer reaches by file path rather than by a static import
// (joshuafolkken/kit#2899): `init` writes `fix-gh-packages.ts` into the consumer's `prepare`, and the lane
// supervisor spawns its CLI, the lane broker its request reread, `run:board` its gathering worker and
// `lane:open` its eslint warm-up by URL. The hook sources (the Codex adapter's fallback included) are
// seeded from `HOOK_BUNDLES`.
const PATH_LAUNCHED_ENTRIES = [
	'scripts/gh/fix-gh-packages.ts',
	'scripts/lane/lane-session-reread-main.ts',
	'scripts/lane/openai-lane-supervisor-cli.ts',
	'scripts/lint/eslint-warm-cli.ts',
	'scripts/run/board/run-board-gather-worker.ts',
]

// Shipped although no consumer entry reaches them: kit's own build and release entries, which run
// from kit's checkout (`pnpm build`, CI workflows). Every other unreachable module is kit-internal
// and belongs in `tools/`, so a kit-only file placed under `scripts/` fails the reachability test.
const SHIPPED_UNREACHABLE = new Set([
	'scripts/build/build-bin.ts',
	'scripts/build/build-claude-md.ts',
	'scripts/build/build-codex-hooks.ts',
	'scripts/build/build-commands.ts',
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

interface CommandFailure {
	stdout?: string
	stderr?: string
}

// With `--json`, pnpm writes its error to stdout rather than stderr, so a failure carries both
// streams — `Command failed` alone left the cause of a flaky run unrecorded (joshuafolkken/kit#3372).
function run_pack(cwd: string): string {
	try {
		return execFileSync('pnpm', ['pack', '--dry-run', '--json', '--config.ignore-scripts=true'], {
			cwd,
			encoding: 'utf8',
			stdio: 'pipe',
		})
	} catch (error) {
		const { stdout = '', stderr = '' } = error as CommandFailure

		throw new Error(`pnpm pack failed in ${cwd}\nstdout:\n${stdout}\nstderr:\n${stderr}`, {
			cause: error,
		})
	}
}

function packed_paths(raw: string): Set<string> {
	const parsed = JSON.parse(raw) as PackReport | Array<PackReport>
	const report = Array.isArray(parsed) ? parsed[0] : parsed

	return new Set((report?.files ?? []).map((entry) => entry.path))
}

function packed_files(): Set<string> {
	return packed_paths(run_pack(REPO_ROOT))
}

function read_manifest(): PackageManifest {
	return JSON.parse(readFileSync(path.join(REPO_ROOT, MANIFEST_NAME), 'utf8')) as PackageManifest
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

describe('a failed pnpm pack', () => {
	it('reports what pnpm printed rather than only that the command failed', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'pack-boundary-'))

		onTestFinished(() => {
			rmSync(directory, { recursive: true, force: true })
		})

		expect(() => run_pack(directory)).toThrow(/stdout:\n\S[\s\S]*ERR_PNPM/u)
	})
})

// The hook cache, the build staging and the build-commands test output are rewritten by every hook
// launch, build and test run, so a pack that lists them races their removal (joshuafolkken/kit#4243,
// #5053). Packed from a copy of kit's `files`, so the patterns are checked without touching this
// checkout's own `dist/`.
function write_hook_scratch(directory: string): void {
	const hooks = path.join(directory, 'dist', 'hooks')

	mkdirSync(hooks, { recursive: true })

	for (const name of [SHIPPED_HOOK, VERIFIED_NAME, `${VERIFIED_NAME}.4243`]) {
		writeFileSync(path.join(hooks, name), '{}')
	}

	for (const prefix of SCRATCH_PREFIXES) {
		const scratch = path.join(directory, 'dist', `${prefix}abc123`)

		mkdirSync(scratch)
		writeFileSync(path.join(scratch, 'chunk-ABC.js'), '')
	}
}

function pack_with_hook_scratch(): Set<string> {
	const directory = mkdtempSync(path.join(tmpdir(), 'pack-boundary-scratch-'))
	const package_json = { name: 'scratch', version: '0.0.0', files: read_manifest().files }

	onTestFinished(() => {
		rmSync(directory, { recursive: true, force: true })
	})
	writeFileSync(path.join(directory, MANIFEST_NAME), JSON.stringify(package_json))
	write_hook_scratch(directory)

	return packed_paths(run_pack(directory))
}

describe('the published package carries no per-machine hook scratch', () => {
	it('ships the hook bundles but not the verified-inputs cache, the build staging or the build-commands test output', () => {
		const packed = pack_with_hook_scratch()
		const scratch = [...packed].filter(
			(file) =>
				file.includes(VERIFIED_NAME) || SCRATCH_PREFIXES.some((prefix) => file.includes(prefix)),
		)

		expect(packed.has(`dist/hooks/${SHIPPED_HOOK}`)).toBe(true)
		expect(scratch).toEqual([])
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

	it('excludes nothing under scripts/ one file at a time — kit-only code lives in tools/', () => {
		const per_file = (read_manifest().files ?? []).filter((entry) =>
			entry.startsWith(SCRIPTS_EXCLUSION_PREFIX),
		)

		expect(per_file).toEqual([])
	})

	it('ships no test snapshot or golden transcript', () => {
		const leaked = [...packed].filter(
			(file) => file.includes('/__snapshots__/') || file.endsWith('.golden.txt'),
		)

		expect(leaked).toEqual([])
	})
})
