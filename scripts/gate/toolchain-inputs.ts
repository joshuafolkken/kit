import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// **The toolchain's inputs, listed once** (joshuafolkken/kit#4496): the files whose content moves what
// a tool answers while every source stays byte-identical — the installed packages, the eslint config
// and the TypeScript program's options. Every result kept across runs is discarded when they move:
// the metrics base cache (`metrics-base-cache.ts`), the hook bundles (`hook-bundle-stamp.ts`), the
// warm ESLint daemon (`eslint-daemon.ts`) and the gate's verdicts (`verification-inputs.ts`). A file
// added here reaches all of them.
//
// Loaded by plain `node` on every hook launch (`tools/hooks/hook-bundle-ready.ts`), so this module
// imports `node:` built-ins alone.

// The package manager's manifest, lock and settings files, and the record pnpm rewrites on every
// install — a consumer's eslint config imports its rules from installed packages.
const PACKAGE_FILES: ReadonlyArray<string> = [
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'package-lock.json',
	'yarn.lock',
	'bun.lock',
	'bun.lockb',
	'.npmrc',
	'node_modules/.modules.yaml',
]
// The root entries of the eslint flat config and of the TypeScript program, and the directories of
// the rule modules and the shared compiler options they import.
const CONFIG_ENTRIES: ReadonlyArray<RegExp> = [
	/^eslint\.config\.[cm]?[jt]s$/u,
	/^tsconfig(?:\.[\w-]+)?\.json$/u,
]
const CONFIG_DIRECTORIES: ReadonlySet<string> = new Set(['eslint', 'tsconfig'])
// A test beside the rule modules configures nothing.
const TEST_MARKER = '.test.'
const SEPARATOR = '/'
const DIGEST_ALGORITHM = 'sha256'

// Code-unit order, so the digest does not depend on the locale of the machine that computes it.
function by_code_unit(left: string, right: string): number {
	if (left === right) return 0

	return left < right ? -1 : 1
}

function to_posix(relative: string): string {
	return relative.split(path.sep).join(SEPARATOR)
}

function is_config_entry(name: string): boolean {
	return CONFIG_ENTRIES.some((entry) => entry.test(name))
}

function is_config_module(relative: string): boolean {
	const [top = ''] = relative.split(SEPARATOR, 1)

	return CONFIG_DIRECTORIES.has(top) && !path.basename(relative).includes(TEST_MARKER)
}

// Whether the root-relative `relative` is a toolchain input.
function is_input(relative: string): boolean {
	const posix = to_posix(relative)
	if (PACKAGE_FILES.includes(posix)) return true

	return is_config_entry(posix) || is_config_module(posix)
}

// Files only: a directory moves on every entry created in it, an editor's temp file too.
function modules_under(root: string, directory: string): ReadonlyArray<string> {
	const absolute = path.join(root, directory)
	if (!existsSync(absolute)) return []

	return readdirSync(absolute, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => to_posix(path.relative(root, path.join(entry.parentPath, entry.name))))
		.filter((relative) => is_config_module(relative))
}

// The root-relative toolchain inputs present under `root`, in code-unit order.
function paths(root: string): ReadonlyArray<string> {
	const present = PACKAGE_FILES.filter((relative) => existsSync(path.join(root, relative)))
	const entries = readdirSync(root).filter((name) => is_config_entry(name))
	const modules = [...CONFIG_DIRECTORIES].flatMap((directory) => modules_under(root, directory))

	return [...present, ...entries, ...modules].toSorted(by_code_unit)
}

function read_or_empty(file: string): Uint8Array {
	try {
		return readFileSync(file)
	} catch {
		return new Uint8Array()
	}
}

// **The fingerprint of the toolchain under `root`**: each input's path and content, in code-unit
// order, so an added, removed, renamed or edited input changes it. A file gone between the listing
// and its read hashes as empty.
function digest(root: string): string {
	const hash = createHash(DIGEST_ALGORITHM)

	for (const relative of paths(root)) {
		hash
			.update(`${relative}\0`)
			.update(read_or_empty(path.join(root, relative)))
			.update('\0')
	}

	return hash.digest('hex')
}

const toolchain_inputs = { digest, is_input, PACKAGE_FILES, paths }

export { toolchain_inputs }
