import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolve_local_bin } from '#scripts/build/local-bin'
import { HOOK_PROCESS_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'

// The spell half of the edit hook. The lint half hands the model an edit's lint problems on the spot
// rather than at the gate; an unregistered word is the other thing that sends a run back to the gate
// — a `cspell:dot` failure a run can only read one word at a time under the output cap. Checking the
// one edited file for unknown words the moment it changes closes that the same way the lint half does:
// a short `additionalContext` block, riding the same `PostToolUse` envelope, and no output at all when
// there is nothing to say.

// **The kinds worth spell-checking on an edit.** cspell will lint any path handed to it, so without a
// filter an edit to a binary asset would be read as text and report its bytes as unknown words. This is
// the text where a real unknown word can live; anything else is a no-op before a process starts. It is
// a spell-check concern of its own, not the prettier/eslint extension lists in `format-edited-file.ts`.
const CSPELL_EXTENSIONS: ReadonlySet<string> = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.svelte',
	'.md',
	'.mdx',
	'.txt',
	'.json',
	'.jsonc',
	'.yml',
	'.yaml',
	'.html',
	'.css',
])

// `lint` so the sub-command is explicit, `--words-only --unique` so stdout is the unknown words and
// nothing else, `--no-progress --no-summary` so neither the progress line nor the tally is on it. The
// exit code is ignored: cspell exits non-zero precisely when it found words, which is the case this
// exists for.
const CSPELL_ARGS: ReadonlyArray<string> = [
	'lint',
	'--words-only',
	'--unique',
	'--no-progress',
	'--no-summary',
]
const CSPELL_BIN = 'cspell'
const PNPM = 'pnpm'
// The text arrives on stdin under the edited file's own name, so the project config — its ignore
// list, its language per extension, its overrides — applies exactly as it does to the path. Reading
// stdin rather than the file is what lets the check run beside the formatters
// (joshuafolkken/kit#4596): they rewrite the file while it runs, and a read caught mid-write would
// report on a truncated file.
const STDIN_SCHEME = 'stdin://'

interface CspellRequest {
	file_path: string
	project_root: string
	text: string
}

type CspellRunner = (request: CspellRequest) => Promise<string>

const HEADER =
	'The edit hook found words cspell does not know; fix them or add them to `cspell.config.yaml` now rather than at the gate:'
// additionalContext rides back on the edit, so a runaway list is bounded the same way the lint half is.
const MAX_DIAGNOSTIC_CHARS = 4000
const TRUNCATION_NOTICE = '\n…(unknown words truncated)'

// One question before a process starts: is this a file under the project that spell-checking has
// anything to say about?
function is_checkable(file_path: string, project_root: string): boolean {
	if (!existsSync(file_path) || !CSPELL_EXTENSIONS.has(path.extname(file_path).toLowerCase())) {
		return false
	}

	const relative = path.relative(path.resolve(project_root), path.resolve(file_path))

	return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

// The project's own shim, spawned directly: `pnpm exec` costs a second process start on every edit,
// and this check was the largest step of the edit hook (joshuafolkken/kit#4596). `pnpm exec` stays as
// the route for a project whose binaries live somewhere other than the root's `node_modules/.bin`.
function cspell_command(project_root: string): ReadonlyArray<string> {
	const shim = resolve_local_bin(project_root, CSPELL_BIN)

	return existsSync(shim) ? [shim] : [PNPM, 'exec', CSPELL_BIN]
}

// The live runner. `reject: false` because a non-zero exit is the ordinary way cspell reports words,
// and stderr is ignored so a config note never reaches the model as if it were an unknown word.
async function run_cspell(request: CspellRequest): Promise<string> {
	const [bin = PNPM, ...prefix] = cspell_command(request.project_root)
	const target = `${STDIN_SCHEME}${path.resolve(request.file_path)}`
	const result = await execa(bin, [...prefix, ...CSPELL_ARGS, target], {
		reject: false,
		cwd: request.project_root,
		input: request.text,
		stdout: 'pipe',
		stderr: 'ignore',
		timeout: HOOK_PROCESS_TIMEOUT_MS,
	})

	return result.stdout
}

// The block the model reads, or `undefined` when cspell knew every word — so an ordinary edit adds
// nothing to additionalContext. The words are cut to the bound before the header is added, so the cap
// covers the whole block.
function format_unknown_words(stdout: string): string | undefined {
	const words = stdout
		.split('\n')
		.map((word) => word.trim())
		.filter((word) => word.length > 0)

	if (words.length === 0) return undefined

	const joined = words.join('\n')
	const body =
		joined.length > MAX_DIAGNOSTIC_CHARS
			? `${joined.slice(0, MAX_DIAGNOSTIC_CHARS)}${TRUNCATION_NOTICE}`
			: joined

	return `${HEADER}\n${body}`
}

// Never turns a successful edit into a failure: a runner that throws — cspell missing, a timeout — is
// swallowed and reported as nothing to say, exactly as the lint half swallows a formatter that could
// not start. `text` is the file's content as the caller read it, so the check does not depend on when
// it runs against the formatters.
async function spelling_diagnostics(
	file_path: string | undefined,
	project_root: string,
	text: string,
	runner: CspellRunner = run_cspell,
): Promise<string | undefined> {
	if (file_path === undefined || !is_checkable(file_path, project_root)) return undefined

	try {
		return format_unknown_words(await runner({ file_path, project_root, text }))
	} catch {
		return undefined
	}
}

const edited_cspell = { cspell_command, format_unknown_words, run_cspell, spelling_diagnostics }

export type { CspellRequest, CspellRunner }
export { edited_cspell, MAX_DIAGNOSTIC_CHARS }
