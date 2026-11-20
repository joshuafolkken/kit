import path from 'node:path'
import { git_argv, type ProgramCall } from '#scripts/rules/git-argv'
import { interpreter_options } from '#scripts/rules/interpreter-options'
import { step_zero_notice } from './step-zero-notice'

// joshuafolkken/kit#8262: a scratch script run directly writes wherever it likes and a revert takes back
// only the files the call names; `josh scratch:run` confines its writes to the scratch area. A scratch
// path is still free as data (`magick a.svg <scratch>/out.png`, `python3 -m json.tool <scratch>/d.json`);
// it is refused where it is run as code: the program word itself, an interpreter's script operand, a
// code-flag value (`make -f`, `node --import`) or a file whose extension is code.

const SCRATCH_RUN =
	'a scratch script run directly, whose writes cannot be verified; run it with `pnpm josh scratch:run <path>`'
const SCRIPT_RUNNERS: ReadonlySet<string> = new Set(
	'node nodejs perl ruby bun deno tsx ts-node bash sh zsh dash ksh fish source . php lua'.split(
		' ',
	),
)
const PYTHON = /^python[\d.]*$/u
const CODE_EXTENSIONS: ReadonlySet<string> = new Set(
	'.sh .bash .zsh .js .mjs .cjs .jsx .ts .mts .cts .tsx .py .rb .pl .php .lua .awk .sed .mk'.split(
		' ',
	),
)
const CODE_FLAGS: ReadonlySet<string> = new Set(
	'-f --file --makefile -r --require --import --loader --experimental-loader --preload'.split(' '),
)
// Programs that never run the files they name as code, so reading a scratch script stays free; `josh`
// passes only as `josh scratch:run`.
const INERT_PROGRAMS: ReadonlySet<string> = new Set(
	'cat diff file grep head less ls mkdir rg stat tail wc'.split(' '),
)
const PWD_PREFIX = /^\$\{?PWD\}?(?=\/|$)/u
const QUOTES = /['"\\]/gu
const NEXT = 1

function is_scratch(word: string | undefined, root: string): boolean {
	if (word === undefined) return false

	const bare = word.replaceAll(QUOTES, '').replace(PWD_PREFIX, () => root)

	return step_zero_notice.is_scratch_file(bare, root)
}

// The value an argument hands its program, after the flag that names it.
function flagged_value(args: ReadonlyArray<string>, index: number): [string, string] {
	const word = args[index] ?? ''
	const equals = word.indexOf('=')

	if (equals === -1 || !word.startsWith('-')) return [args[index - NEXT] ?? '', word]

	return [word.slice(0, equals), word.slice(equals + NEXT)]
}

function is_scratch_code(args: ReadonlyArray<string>, index: number, root: string): boolean {
	const [flag, value] = flagged_value(args, index)
	const is_code = CODE_FLAGS.has(flag) || CODE_EXTENSIONS.has(path.extname(value))

	return is_code && is_scratch(value, root)
}

function runs_scratch_code(
	call: ProgramCall,
	root: string,
	redirected: ReadonlySet<string>,
): boolean {
	return call.args.some(
		(argument, index) => !redirected.has(argument) && is_scratch_code(call.args, index, root),
	)
}

function runs_scratch_operand(call: ProgramCall, root: string): boolean {
	if (!SCRIPT_RUNNERS.has(call.name) && !PYTHON.test(call.name)) return false

	return is_scratch(interpreter_options.script_operand(call), root)
}

// The program word as typed, before `program_of` cut it to its last path component.
function program_word(segment: string, call: ProgramCall): string | undefined {
	const words = git_argv.words_of(segment)

	return words[words.length - call.args.length - NEXT]
}

function runs_scratch(
	segment: string,
	call: ProgramCall,
	root: string,
	redirected: ReadonlySet<string>,
): boolean {
	return (
		is_scratch(program_word(segment, call), root) ||
		runs_scratch_operand(call, root) ||
		runs_scratch_code(call, root, redirected)
	)
}

function is_exempt(call: ProgramCall): boolean {
	if (INERT_PROGRAMS.has(call.name)) return true

	return call.name === 'josh' && call.args[0] === 'scratch:run'
}

// `call` carries its quotes stripped; `redirected` holds the segment's redirect targets, which the
// redirect check judges.
function refusal(
	segment: string,
	call: ProgramCall,
	root: string,
	redirected: ReadonlyArray<string>,
): string | undefined {
	if (is_exempt(call)) return undefined

	const targets = new Set(redirected.map((target) => target.replaceAll(QUOTES, '')))

	return runs_scratch(segment, call, root, targets) ? SCRATCH_RUN : undefined
}

const implementation_shell_scratch = { refusal }

export { implementation_shell_scratch }
