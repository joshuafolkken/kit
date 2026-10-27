import { readFileSync } from 'node:fs'
import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { no_base_checkout } from '#scripts/git/no-base-checkout'
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

// The names a file that resolves the base, or reads a diff against it, carries — the modules'
// own, and the bare default-branch name a caller could hand git.
const BASE_NAMES: ReadonlyArray<string> = [
	'change_base',
	'default_branch',
	'diff_main',
	"'main'",
	'"main"',
]

// Shared with `test-related.ts`'s own reading of which files name another: a file it cannot read
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

function touches_base(root: string, file: string): boolean {
	if (!related_scope.is_relatable(file)) return false

	return names_any(text_of(path.join(root, file)), BASE_NAMES)
}

function touching(root: string, changed: ReadonlyArray<string>): Array<string> {
	return changed.filter((file) => touches_base(root, file))
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

const test_no_base = { names_any, run_if_touched, text_of, touching }

export { test_no_base }
