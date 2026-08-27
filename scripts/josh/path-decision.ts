import { changed_paths } from '#scripts/git/changed-paths'

// The shape both path-decided commands share (joshuafolkken/kit#907).
//
// `josh review:level` and `josh eval:scope` ask different questions of the same tree, and they answer
// the same way: read the changed paths, decide from them alone, print the answer on stdout and the reason on
// stderr. Only the question differs, so only the question is written twice — a second copy of the
// reading, the flags and the printing would let two commands disagree about what "changed" means.

const STAGED_FLAG = '--staged'
const JSON_FLAG = '--json'
const KNOWN_FLAGS: ReadonlyArray<string> = [STAGED_FLAG, JSON_FLAG]
const FAILURE_EXIT_CODE = 1
// Enough paths to recognize the change, and a count for the rest. A reason that printed every path
// of a large diff would bury the answer it exists to explain.
const MAX_LISTED_PATHS = 5

interface DecisionOptions {
	is_staged: boolean
	is_json: boolean
}

// What a command has to supply: its usage line, the key its `--json` form has always used, the
// decision, and the sentence explaining it.
interface DecisionCommand<Answer extends string> {
	usage: string
	key: string
	decide: (paths: ReadonlyArray<string>) => Answer
	explain: (paths: ReadonlyArray<string>, answer: Answer) => string
}

// `undefined` rather than a default on an unknown flag: a misspelled `--stage` that silently read
// the branch diff would answer a question nobody asked, and answer it confidently.
function parse_options(argv: ReadonlyArray<string>): DecisionOptions | undefined {
	if (argv.some((argument) => !KNOWN_FLAGS.includes(argument))) return undefined

	return { is_staged: argv.includes(STAGED_FLAG), is_json: argv.includes(JSON_FLAG) }
}

function format_path_list(paths: ReadonlyArray<string>): string {
	const listed = paths.slice(0, MAX_LISTED_PATHS).join(', ')

	if (paths.length <= MAX_LISTED_PATHS) return listed

	return `${listed}, +${String(paths.length - MAX_LISTED_PATHS)} more`
}

// The answer alone on stdout so `$(pnpm josh <command>)` reads it, and the reason on stderr so a
// person sees why without a shell having to parse around it. `--json` puts both in one object under
// the key that command has always used — `level` for `review:level`, `scope` for `eval:scope`.
function print_decision(key: string, answer: string, reason: string, is_json: boolean): void {
	if (is_json) {
		console.info(JSON.stringify({ [key]: answer, reason }))

		return
	}

	console.info(answer)
	console.error(reason)
}

async function run_path_decision<Answer extends string>(
	argv: ReadonlyArray<string>,
	command: DecisionCommand<Answer>,
): Promise<number> {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(command.usage)

		return FAILURE_EXIT_CODE
	}

	const paths = await changed_paths.read_changed_paths(options.is_staged)
	const answer = command.decide(paths)

	print_decision(command.key, answer, command.explain(paths, answer), options.is_json)

	return 0
}

const path_decision = {
	format_path_list,
	JSON_FLAG,
	KNOWN_FLAGS,
	MAX_LISTED_PATHS,
	parse_options,
	print_decision,
	run_path_decision,
	STAGED_FLAG,
}

export type { DecisionCommand, DecisionOptions }
export { path_decision }
