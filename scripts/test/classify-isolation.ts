#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process'
import { globSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VITEST_INCLUDE_GLOBS } from './vitest-include-globs'

// Isolation requirements — a test matching ANY condition below mutates state a sibling test running
// in the same worker could observe, so it must run with the default isolate:true and must NOT appear
// in the generated pilot list. The classifier is deliberately conservative: a file it cannot decide
// is left isolated, because a false "pure" costs a flaky pilot while a false "isolate" costs only a
// little speed.
//   1. Module mocks: vi.mock / vi.spyOn / vi.stubEnv / vi.stubGlobal / vi.resetModules /
//      vi.unstubAllEnvs / vi.unstubAllGlobals
//   2. Environment variable writes: process.env.X = ... or delete process.env.X
//   3. Subprocess calls: execSync / spawnSync / spawn / exec / execa / child_process.*
//   4. Filesystem writes: writeFileSync / mkdirSync / mkdtemp / rmSync / unlinkSync / rimraf
//   5. Git operations: enforced by condition 3 — every git operation spawns a process, so a file
//      that runs git already matches the subprocess pattern.

const MOCK_TOKENS: ReadonlyArray<string> = [
	'mock',
	'spyOn',
	'stubEnv',
	'stubGlobal',
	'resetModules',
	'unstubAllEnvs',
	'unstubAllGlobals',
]
// Bare `exec` is deliberately absent: it matches the pure word (`pnpm exec …`, `regex.exec(…)`) more
// often than the child_process call, which an `execSync` / `child_process` token catches anyway.
const SUBPROCESS_TOKENS: ReadonlyArray<string> = [
	'execSync',
	'execFileSync',
	'spawnSync',
	'execaSync',
	'execa',
	'spawn',
	'child_process',
]
const FS_WRITE_TOKENS: ReadonlyArray<string> = [
	'writeFileSync',
	'writeFile',
	'appendFileSync',
	'mkdirSync',
	'mkdtempSync',
	'mkdtemp',
	'rmSync',
	'rmdirSync',
	'unlinkSync',
	'cpSync',
	'copyFileSync',
	'renameSync',
	'rimraf',
]

function word_pattern(tokens: ReadonlyArray<string>): RegExp {
	return new RegExp(String.raw`\b(?:${tokens.join('|')})\b`, 'u')
}

const MODULE_MOCKS = new RegExp(String.raw`\bvi\.(?:${MOCK_TOKENS.join('|')})\b`, 'u')
const ENV_WRITES =
	/(?:process\.env\.\w+\s*=(?!=)|process\.env\[[^\]]+\]\s*=(?!=)|delete\s+process\.env)/u
const SUBPROCESS = word_pattern(SUBPROCESS_TOKENS)
const FS_WRITES = word_pattern(FS_WRITE_TOKENS)

const ISOLATION_PATTERNS: ReadonlyArray<RegExp> = [MODULE_MOCKS, ENV_WRITES, SUBPROCESS, FS_WRITES]

// Excluded from the main suite in vitest.config.ts (packs and installs the real tarball), so it must
// never reach the pilot either.
const MAIN_EXCLUDE = new Set(['scripts/build/packed-consumer.test.ts'])
const NODE_MODULES = 'node_modules'
const MAX_GIT_OUTPUT = 20_971_520 // 20 MiB — well above any plausible tracked-file listing
const PILOT_FILES_PATH = 'scripts/test/pilot-files.ts'
const WRITE_FLAG = '--write'
const INDENT = '\t'
const UTF8 = 'utf8'

const GENERATED_HEADER = `/* eslint-disable max-lines */
// GENERATED FILE — do not edit by hand.
// Regenerate with: pnpm exec tsx scripts/test/classify-isolation.ts --write
// Every entry is a test file the classifier judges free of the isolation requirements documented in
// classify-isolation.ts; these files run with isolate:false in vitest.pilot.config.ts.`

function normalize_path(file: string): string {
	return file.split(path.sep).join('/')
}

function is_in_node_modules(entry: string): boolean {
	return entry.split(/[/\\]/u).includes(NODE_MODULES)
}

function collect_glob(glob: string): Array<string> {
	return globSync(glob, { exclude: is_in_node_modules }).map((file) => normalize_path(file))
}

// Code-point order, never localeCompare: the list is generated on one machine and re-derived in CI,
// and ICU collation differs across platforms — so localeCompare reorders the list under CI's Linux
// ICU and fails the drift test on order alone (joshuafolkken/kit#2170).
function by_code_point(left: string, right: string): number {
	if (left < right) return -1

	return left > right ? 1 : 0
}

// Git-tracked test files only. The classifier runs inside the unit suite, and other tests write
// transient `*.test.ts` fixtures into scanned directories while it runs; a live `globSync` picks
// those up, so the committed list and a fresh scan disagree in CI (joshuafolkken/kit#2170). The
// tracked set is the hermetic source — untracked fixtures never enter it.
function tracked_files(): Set<string> {
	const output = execFileSync('git', ['ls-files', '-z', '--', '*.test.ts'], {
		encoding: 'utf8',
		maxBuffer: MAX_GIT_OUTPUT,
	})

	return new Set(output.split('\0').filter(Boolean))
}

function all_test_files(): Array<string> {
	const tracked = tracked_files()
	const files = VITEST_INCLUDE_GLOBS.flatMap((glob) => collect_glob(glob))

	return [...new Set(files)]
		.filter((file) => tracked.has(file) && !MAIN_EXCLUDE.has(file))
		.toSorted(by_code_point)
}

function requires_isolation(source: string): boolean {
	return ISOLATION_PATTERNS.some((pattern) => pattern.test(source))
}

function is_pilot_candidate(file: string): boolean {
	return !requires_isolation(readFileSync(file, UTF8))
}

function classify_pilot_files(): Array<string> {
	return all_test_files().filter((file) => is_pilot_candidate(file))
}

function render_pilot_files(files: ReadonlyArray<string>): string {
	const entries = files.map((file) => `${INDENT}'${file}',`).join('\n')
	const body = `const PILOT_FILES: ReadonlyArray<string> = [\n${entries}\n]`

	return `${GENERATED_HEADER}\n\n${body}\n\nexport { PILOT_FILES }\n`
}

function write_pilot_files(): void {
	writeFileSync(PILOT_FILES_PATH, render_pilot_files(classify_pilot_files()))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv.includes(WRITE_FLAG)) write_pilot_files()
	else process.stdout.write(`${classify_pilot_files().join('\n')}\n`)
}

const classify_isolation = {
	ISOLATION_PATTERNS,
	all_test_files,
	by_code_point,
	classify_pilot_files,
	is_pilot_candidate,
	render_pilot_files,
	requires_isolation,
	tracked_files,
	write_pilot_files,
}

export { classify_isolation }
