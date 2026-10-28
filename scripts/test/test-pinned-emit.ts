import type { TypeScriptApi } from '#scripts/review/comment-ranges'
import { test_pinned_functions } from './test-pinned-functions'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'
import { test_pinned_rewire } from './test-pinned-rewire'

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

interface RuntimeRead {
	hunks: Array<Hunk>
	rewired: number
}

// The hunks to probe, each beside its file's content: the ones whose revert changes the emitted code,
// less the rewires (`test-pinned-rewire.ts`), which are counted.
function probed_of(
	api: TypeScriptApi,
	hunks: ReadonlyArray<Hunk>,
	contents: ReadonlyArray<string>,
): RuntimeRead {
	const runtime = hunks
		.map((hunk, index) => ({ hunk, content: contents[index] ?? '' }))
		.filter((read) => changes_runtime(api, read.content, read.hunk))
	const probed = runtime.filter(
		(read) => !test_pinned_rewire.is_rewire(api, read.content, read.hunk),
	)

	return { hunks: probed.map((read) => read.hunk), rewired: runtime.length - probed.length }
}

const test_pinned_emit = { changes_runtime, probed_of }

export { test_pinned_emit }
