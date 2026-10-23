import type { TypeScriptApi } from '#scripts/review/comment-ranges'
import { test_pinned_functions } from './test-pinned-functions'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'

// Which hunks `josh test:pinned` can probe at all (joshuafolkken/kit#4647). A hunk whose revert leaves
// the emitted JavaScript as it was — a comment, a type, a blank line — changes nothing a test runs, so
// no test can pin it, and listing it `unpinned` would stop every `josh run:review` that edited one.
// Only a script file is compared: a Svelte component's markup is not TypeScript.

function emitted(api: TypeScriptApi, file: string, content: string): string {
	const compiler_options = { removeComments: true, target: api.ScriptTarget.ESNext }

	return api.transpileModule(content, { compilerOptions: compiler_options, fileName: file })
		.outputText
}

function changes_runtime(api: TypeScriptApi, content: string, hunk: Hunk): boolean {
	if (!test_pinned_functions.is_script(hunk.file)) return true
	const reverted = test_pinned_logic.revert(content, hunk)

	return emitted(api, hunk.file, reverted) !== emitted(api, hunk.file, content)
}

const test_pinned_emit = { changes_runtime }

export { test_pinned_emit }
