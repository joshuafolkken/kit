import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1517: `os.tmpdir()` answers the same directory for every process of the user, so
// a fixture directory named by a literal — `path.join(tmpdir(), 'sync-test')` — is one directory
// shared by every unit suite running on the machine at that moment. Two concurrent suites are
// enough: one suite's `afterEach` removes the whole tree while the other is still reading from it,
// and the failures surface as ENOENT / ENOTEMPTY on files nobody edited, which is indistinguishable
// from a real regression.
//
// Reducing vitest workers does not help, because the contended resource is a directory rather than
// the CPU — that multiplier is joshuafolkken/kit#1515, and the two are separate defects.
//
// The fix is `mkdtempSync`, already the practice in `run/run-liveness.test.ts` and
// `init/init-logic.prepare.test.ts`. This guard is what keeps the fixed-name shape from returning.
//
// It is a textual scan and has one edge it does not cover: `const TEMP_ROOT = tmpdir()` followed by
// `path.join(TEMP_ROOT, 'sync-test')` rebuilds the shared directory without spelling `tmpdir()`
// inside the join. Closing that needs type information this scan does not have; what it does cover
// is every spelling the repository actually contains. The `node:fs` qualification below has the
// matching edge: a suite that names the path and hands it to a helper module that does the writing
// imports no `fs` of its own, and is exempted along with the string-only suites.

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')
// `dist` is build output — a match there would be a copy of a source file this scan already read,
// reported at a path nobody edits.
const SKIPPED_ROOTS: ReadonlySet<string> = new Set(['node_modules', 'dist'])
// This file quotes the forbidden shape in its own detector cases, so it is the one file the scan
// skips. Nothing else may be exempted: an exemption list is what the qualification below replaces.
const SELF_NAME = path.basename(fileURLToPath(import.meta.url))
// Prettier wraps a long `mkdtempSync(path.join(tmpdir(), '…'))` onto three lines, so the whitespace
// after the call is closed up before the scan runs. That keeps the lookbehind below fixed-length,
// and it is what stops the guard failing on the very code it exists to require.
const WRAPPED_UNIQUE_CALL = /mkdtempSync\(\s+/gu
// `path.join(tmpdir(), 'name')` — a plain string literal, so the path is identical in every
// concurrent run. An argument written as a template literal is left alone: the stamp files keyed on
// `process.pid` are already unique, and that is the escape the interpolation buys. The lookbehind is
// what lets the fix itself through, and the optional comma is what keeps a *wrapped* offender from
// escaping: prettier puts a trailing comma where the close paren would otherwise be.
const FIXED_JOIN =
	/(?<!mkdtempSync\()path\.join\(\s*(?:os\.)?tmpdir\(\)\s*,\s*(['"])[^'"\n]*\1(?:\s*,)?\s*\)/gu
// The same path spelled by interpolation instead, with nothing inside it that varies per run.
const FIXED_TEMPLATE = /(?<!mkdtempSync\()`\$\{\s*(?:os\.)?tmpdir\(\)\s*\}\/[^`$\n]*`/gu
const FIXED_PATTERNS: ReadonlyArray<RegExp> = [FIXED_JOIN, FIXED_TEMPLATE]
// A suite that never opens the filesystem cannot race on a path — it compares strings, and
// `check-commit-message.test.ts` asserting that a temp-dir path is accepted is exactly that.
// Qualifying on the import rather than naming files means adding an `fs` import to such a file
// brings it under the guard on the spot, with no list anyone has to remember to update.
const FS_IMPORT = /from '(?:node:)?fs(?:\/promises)?'/u
const SCANNED_SUFFIXES: ReadonlyArray<string> = ['.test.ts', '-fixture.ts']

function is_scanned(entry: string): boolean {
	if (path.basename(entry) === SELF_NAME) return false
	if (entry.includes('node_modules')) return false

	return SCANNED_SUFFIXES.some((suffix) => entry.endsWith(suffix))
}

// Every source root, not just `scripts/`: `eslint/` and `ports/` build temp fixtures too, and a
// scan rooted at this file's own directory would let a regression there ship green.
function source_roots(): Array<string> {
	return readdirSync(REPO_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.filter((entry) => !SKIPPED_ROOTS.has(entry.name))
		.map((entry) => entry.name)
}

function files_under(root: string): Array<string> {
	return readdirSync(path.join(REPO_ROOT, root), { encoding: 'utf8', recursive: true })
		.map((entry) => path.join(root, entry))
		.filter((entry) => is_scanned(entry))
		.map((entry) => path.join(REPO_ROOT, entry))
}

// The repository root holds test files of its own — `playwright.config.test.ts` and its fixture —
// and a walk that only descended into directories would never open them.
function root_files(): Array<string> {
	return readdirSync(REPO_ROOT, { encoding: 'utf8' })
		.filter((entry) => is_scanned(entry))
		.map((entry) => path.join(REPO_ROOT, entry))
}

function scanned_files(): Array<string> {
	return [...root_files(), ...source_roots().flatMap((root) => files_under(root))]
}

function matches_in(content: string, pattern: RegExp): Array<string> {
	return Array.from(content.matchAll(pattern), (match) => match[0])
}

function fixed_temporary_paths(content: string): Array<string> {
	const closed_up = content.replaceAll(WRAPPED_UNIQUE_CALL, 'mkdtempSync(')

	return FIXED_PATTERNS.flatMap((pattern) => matches_in(closed_up, pattern))
}

function offenders_in(file: string): Array<string> {
	const content = readFileSync(file, 'utf8')

	if (!FS_IMPORT.test(content)) return []

	return fixed_temporary_paths(content).map(
		(match) => `${path.relative(REPO_ROOT, file)}: ${match}`,
	)
}

describe('temp directories in test suites', () => {
	// The acceptance condition of joshuafolkken/kit#1517, stated as a property of the tree rather than
	// of the two files the issue named: no suite may name a temp path another suite can also name.
	it('names no temp path that concurrent suites would share', () => {
		expect(scanned_files().flatMap((file) => offenders_in(file))).toStrictEqual([])
	})

	// The third case is the offender prettier produces once the constant name is long: the trailing
	// comma sits where the close paren would otherwise be, which is what an earlier version of this
	// pattern required and what let a wrapped fixed name through.
	it.each([
		['a fixture directory named by a literal', "const dir = path.join(tmpdir(), 'shared-fixture')"],
		['the same path spelled as a template literal', 'const dir = `${os.tmpdir()}/shared-fixture`'],
		[
			'a fixture directory prettier has wrapped across lines',
			"const dir = path.join(\n\ttmpdir(),\n\t'shared-fixture',\n)",
		],
	])('reports %s', (_label, sample) => {
		expect(fixed_temporary_paths(sample)).toHaveLength(1)
	})

	// The second case is what prettier does to `mkdtempSync(path.join(tmpdir(), '…'))` once the prefix
	// outgrows the print width: read a line at a time, its argument is indistinguishable from a fixed
	// name, which would fail the suite on the very code this guard exists to require.
	it.each([
		['the literal that names a mkdtemp prefix', 'const d = mkdtempSync(path.join(tmpdir(), "u-"))'],
		[
			'a mkdtemp call prettier has wrapped across lines',
			"const d = mkdtempSync(\n\tpath.join(tmpdir(), 'a-very-long-prefix-'),\n)",
		],
		[
			'a path made unique by an interpolation',
			'const stamp = path.join(tmpdir(), `stamp-${String(process.pid)}.json`)',
		],
	])('accepts %s', (_label, sample) => {
		expect(fixed_temporary_paths(sample)).toStrictEqual([])
	})
})
