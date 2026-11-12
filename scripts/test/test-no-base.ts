import { readFileSync } from 'node:fs'
import { project_checks } from '#scripts/gate/project-checks'
import { no_base_checkout } from '#scripts/git/no-base-checkout'
import { direct_importers, type ImportMap, type SourceReader } from './direct-importers'
import { test_related_claim } from './test-related-claim'
import { related_scope } from './test-related-scope'
import { test_unit_guard } from './test-unit-guard'

// **The second pass of `josh test:related` for a change that touches how the base branch is
// resolved** (joshuafolkken/kit#4710). A lane has a local `main`; CI's checkout has none, so a diff
// against a bare `main` passes every local check and fails only in CI. The related tests of each such
// file run again in `no-base-checkout.ts`'s checkout, which has none either.
//
// **A change that touches none of it runs nothing more** — no checkout, no vitest — so the gate takes
// no longer for it. **Nor does a consumer project**: the checkout holds only what git tracks, and a
// consumer's vitest config can read a generated, ignored file (`.svelte-kit/tsconfig.json`) it lacks.

// The modules that resolve the base, or read a diff against it (joshuafolkken/kit#6186). A file is
// touching when it is one of them or imports one of the two roots at run time — a file merely naming
// `'main'` is not. A caller of the wrappers gets paths already resolved, and `git_command`, which
// re-exports the diff reads, is imported too widely to count.
const BASE_ROOTS: ReadonlySet<string> = new Set([
	'scripts/git/change-base',
	'scripts/git/git-diff-reads',
])
const BASE_MODULES: ReadonlySet<string> = new Set([
	...BASE_ROOTS,
	'scripts/git/changed-file-scope',
	'scripts/git/changed-paths',
	'scripts/git/changed-paths-sync',
])

// A type-only import erases at run time, so it resolves nothing.
const TYPE_ONLY_IMPORT = /^import type (?!from )[^"']*["'][^"']*["']/gmu

// Kept for `test-related.ts`'s own reading of which files name another: a file it cannot read
// names nothing.
function text_of(file_path: string): string {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return ''
	}
}

function names_any(text: string, names: ReadonlyArray<string>): boolean {
	return names.some((name) => text.includes(name))
}

function imports_base(source: string, file: string, imports: ImportMap): boolean {
	const runtime = source.replaceAll(TYPE_ONLY_IMPORT, '')

	return direct_importers.names_any(runtime, file, BASE_ROOTS, imports)
}

function touches_base(file: string, reader: SourceReader): boolean {
	if (!related_scope.is_relatable(file)) return false
	if (BASE_MODULES.has(direct_importers.module_key(file))) return true

	const source = reader.read_source(file)

	return source !== undefined && imports_base(source, file, reader.imports)
}

function touching(root: string, changed: ReadonlyArray<string>): Array<string> {
	const reader = direct_importers.source_reader(root)

	return changed.filter((file) => touches_base(file, reader))
}

async function run_in_checkout(
	root: string,
	files: ReadonlyArray<string>,
	flags: ReadonlyArray<string>,
): Promise<number> {
	const directory = await no_base_checkout.create(root)

	try {
		return await test_unit_guard.run_vitest_in(directory, ['related', ...files, '--run', ...flags])
	} finally {
		no_base_checkout.remove(directory)
	}
}

async function run_if_touched(
	root: string,
	changed: ReadonlyArray<string>,
	flags: ReadonlyArray<string>,
): Promise<number> {
	const files = project_checks.is_kit_repository(root) ? touching(root, changed) : []

	if (files.length === 0) return 0

	process.stdout.write(
		`josh test:related: ${String(files.length)} changed file(s) touch the base branch's resolution — their related tests run again in a checkout with no local main, as CI's has none\n`,
	)

	// Its own claim, since the first pass released its own before this one starts.
	return await test_related_claim.with_unit_claim(
		files,
		async () => await run_in_checkout(root, files, flags),
	)
}

const test_no_base = { imports_base, names_any, run_if_touched, text_of, touching }

export { test_no_base }
