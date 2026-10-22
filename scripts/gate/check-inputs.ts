import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { test_related } from '#scripts/test/test-related'
import {
	verification_inputs,
	type InputDeclaration,
	type PrettierIgnored,
} from './verification-inputs'

// The file-level answer of a check's declaration (`verification-inputs.ts`): whether any of the paths
// that moved is one the check reads, so a gate re-run reuses a check none of whose inputs moved
// (`check-reuse.ts`). It lives apart from the declarations because following imports reads the
// test-read map (`test-related.ts`), whose own since-green narrowing reads the declarations.
//
// **The unit step's inputs are the test-read map's, not a guess** (joshuafolkken/kit#4314): it is
// reusable only when `josh test:related` would run no test for what moved — every moved file one no
// recorded test reads. No map, or one recorded on a tree git can no longer diff against, reaches every
// test, so the step runs.

function prettier_ignored(root: string): PrettierIgnored {
	const ignore_path = verification_inputs.PRETTIER_IGNORE_FILES.map((name) => path.join(root, name))

	return async function is_ignored(relative: string): Promise<boolean> {
		try {
			const prettier = await import('prettier')
			const info = await prettier.getFileInfo(path.join(root, relative), {
				ignorePath: ignore_path,
			})

			return info.ignored
		} catch {
			return false
		}
	}
}

async function reads_any(
	declaration: InputDeclaration,
	paths: ReadonlyArray<string>,
	is_ignored: PrettierIgnored,
	root: string,
): Promise<boolean> {
	if (declaration.follows_imports) return await test_related.reaches_tests(root, paths)

	const { is_input } = declaration

	if (is_input === undefined) return true

	const answers = await Promise.all(
		paths.map(async (relative) => await is_input(relative, is_ignored)),
	)

	return answers.includes(true)
}

// Whether any of `paths` (repository-root relative) is an input of the check `label`. An undeclared
// check answers `true` for every set of paths, so the only way to reuse it is never.
async function touches_inputs(
	label: string,
	paths: ReadonlyArray<string>,
	is_ignored: PrettierIgnored,
	root: string = PROJECT_ROOT,
): Promise<boolean> {
	const declaration = verification_inputs.declaration_of(label)

	if (declaration === undefined || verification_inputs.configures(label, paths)) return true

	return await reads_any(declaration, paths, is_ignored, root)
}

const check_inputs = { prettier_ignored, touches_inputs }

export { check_inputs }
