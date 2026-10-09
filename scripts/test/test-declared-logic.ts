// The verdict `josh test:declared` prints, decided from the changed paths alone.
//
// **The input is a set of paths, never a judgement.** The spelling of a test file is fixed by
// `eslint/rules/test-filename.js` (`*.test.ts` / `*.e2e.ts`), and the mechanically-exempt non-runtime
// paths are an enumeration — docs and editor/IDE settings. So "a runtime file changed and no test file
// changed with it" is a set comparison, which is exactly the reason `CLAUDE.md` gives for it not being
// a judgement.
//
// **The exemption is deliberately conservative, and it is the opposite of `review-level.ts`'s inert
// set.** That set keeps documentation *out* because a human reading the prose is the only thing that
// can catch a defect in it; this set keeps documentation *in* because a test could never have caught a
// prose defect either way. The two answer different questions, so sharing one list would be wrong, not
// a clone avoided. Here only paths that are mechanically certain to touch no runtime code are exempt —
// the non-executable config and cosmetic-asset arms of `prompts/testing-guide.md`'s "Non-runtime updates" exception
// stay `required`, and a person declares that exception in the Step 0 work summary. Under-exempting
// costs one declared exception; over-exempting ships an untested runtime change. The one widening is
// the basic profile's manual check below, for files no runner kit has could test.

type Verdict = 'required' | 'exempt' | 'satisfied'

// A change that carries a test. `.svelte.test.ts` ends with `.test.ts`, so the two suffixes cover it.
const TEST_SUFFIXES: ReadonlyArray<string> = ['.e2e.ts', '.test.ts']

// docs, and the editor/IDE settings that neither execute nor ship a runtime path. The strings are
// matched against `CLAUDE.md`'s enumeration by `test-declared-document-rule.test.ts`, the same way
// `review-level-document-rule.test.ts` pins the inert set.
const EXEMPT_PATHS: ReadonlyArray<string> = ['.editorconfig']
const EXEMPT_PREFIXES: ReadonlyArray<string> = ['.idea/', '.vscode/', 'prompts/']
const EXEMPT_SUFFIXES: ReadonlyArray<string> = ['.md']
const BASIC_VISUAL_SUFFIXES: ReadonlyArray<string> = ['.html', '.css']

// What stays `required` under the basic profile: the languages kit's own
// runner can test, and the data and config formats a JS/TS test can load. Any other file — HTML/CSS, or
// the source of a project kit does not run, such as Lua — has no test kit could execute, so `required`
// there would be unsatisfiable; it is confirmed by hand instead. The kept side is enumerated rather than
// the manual one, because that side is closed.
const BASIC_REQUIRED_SUFFIXES: ReadonlyArray<string> = [
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
	'.json',
	'.jsonc',
	'.json5',
	'.yaml',
	'.yml',
	'.toml',
]

function normalize(paths: ReadonlyArray<string>): Array<string> {
	return paths.map((path) => path.trim()).filter((path) => path !== '')
}

function is_test_file(path: string): boolean {
	return TEST_SUFFIXES.some((suffix) => path.endsWith(suffix))
}

// Matched case-insensitively, so `Main.TS` is not mistaken for a language kit cannot test.
function is_basic_manual(path: string, is_basic: boolean): boolean {
	const lower = path.toLowerCase()

	return is_basic && BASIC_REQUIRED_SUFFIXES.every((suffix) => !lower.endsWith(suffix))
}

function is_basic_visual(path: string): boolean {
	const lower = path.toLowerCase()

	return BASIC_VISUAL_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

function is_exempt(path: string, is_basic = false): boolean {
	if (EXEMPT_PATHS.includes(path) || is_basic_manual(path, is_basic)) return true

	return (
		EXEMPT_SUFFIXES.some((suffix) => path.endsWith(suffix)) ||
		EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))
	)
}

// A runtime file is one that is neither a test nor exempt. Its presence with no test file beside it is
// the whole of what `required` reports.
function is_runtime(path: string, is_basic = false): boolean {
	return !is_test_file(path) && !is_exempt(path, is_basic)
}

// **A test file changed → `satisfied`, whatever else did.** A runtime file with no test beside it →
// `required`. Everything left — an all-exempt change, and the empty diff — is `exempt`, because there
// is no runtime file the change failed to test.
function verdict_for(paths: ReadonlyArray<string>, is_basic = false): Verdict {
	const changed = normalize(paths)

	if (changed.some((path) => is_test_file(path))) return 'satisfied'
	if (changed.some((path) => is_runtime(path, is_basic))) return 'required'

	return 'exempt'
}

// The runtime files with no test beside them — the `required` detail line, so the answer says which
// files it is about rather than only that it refused.
function runtime_files(paths: ReadonlyArray<string>, is_basic = false): Array<string> {
	return normalize(paths).filter((path) => is_runtime(path, is_basic))
}

// The paths that made the change exempt — the `exempt` detail line.
function exempt_files(paths: ReadonlyArray<string>, is_basic = false): Array<string> {
	return normalize(paths).filter((path) => is_exempt(path, is_basic))
}

// The paths exempt only because the basic profile has no runner for them — the ones a person still has
// to confirm by hand, as opposed to docs and editor settings, which nobody checks.
function manual_check_files(paths: ReadonlyArray<string>, is_basic: boolean): Array<string> {
	return normalize(paths).filter((path) => is_exempt(path, is_basic) && !is_exempt(path))
}

const test_declared_logic = {
	EXEMPT_PATHS,
	EXEMPT_PREFIXES,
	EXEMPT_SUFFIXES,
	exempt_files,
	is_basic_visual,
	is_exempt,
	is_runtime,
	is_test_file,
	manual_check_files,
	runtime_files,
	verdict_for,
}

export type { Verdict }
export { test_declared_logic }
