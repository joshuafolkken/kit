import { fileURLToPath } from 'node:url'
import { git_stash } from './git-stash'
import { stash_pop_args, type Request } from './stash-pop-args'

// `josh stash:pop "<message>"` — pop the stash whose message matches, and no other
// (joshuafolkken/kit#2050). The stash stack is shared by every working tree of the repository, so a
// procedure that pops by position takes whatever another lane last pushed. This resolves the
// selector from the message and pops that entry alone; no match and more than one match are both
// refusals rather than a guess at which was meant.

const POPPED_VERDICT = 'popped'
const CONFLICTED_VERDICT = 'conflicted'
const NO_MATCH_VERDICT = 'no-match'
const AMBIGUOUS_VERDICT = 'ambiguous'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2

function report(verdict: string, detail: string, code: number): number {
	console.info(verdict)
	console.error(detail)

	return code
}

function refuse(): number {
	console.error(stash_pop_args.USAGE)

	return FAILURE_EXIT_CODE
}

// A pop that leaves unmerged paths applied the stash and only needs the conflicts resolved, so it is
// reported `conflicted` at exit 0 rather than raised as an unknown failure (joshuafolkken/kit#2050);
// any other pop error is re-thrown for `run` to report. `has_conflict` reads the tree the pop wrote.
async function pop_selected(selector: string, directory: string | undefined): Promise<number> {
	try {
		await git_stash.pop(selector, directory)
	} catch (error) {
		if (await git_stash.has_conflict(directory)) {
			const detail = `Popped ${selector} with conflicts — resolve them.`

			return report(CONFLICTED_VERDICT, detail, SUCCESS_EXIT_CODE)
		}

		throw error
	}

	return report(POPPED_VERDICT, `Popped ${selector}.`, SUCCESS_EXIT_CODE)
}

async function answer(request: Request): Promise<number> {
	const selection = git_stash.select(await git_stash.list(request.dir), request.message)

	if (selection.kind === 'none') {
		return report(NO_MATCH_VERDICT, `No stash matches "${request.message}".`, FAILURE_EXIT_CODE)
	}

	if (selection.kind === 'ambiguous') {
		const detail = `More than one stash matches "${request.message}": ${selection.selectors.join(', ')}.`

		return report(AMBIGUOUS_VERDICT, detail, FAILURE_EXIT_CODE)
	}

	return await pop_selected(selection.selector, request.dir)
}

function report_unknown(error: unknown): number {
	console.error(error instanceof Error ? error.message : String(error))

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = stash_pop_args.read_arguments(argv)

	if (parsed === undefined) return refuse()

	const request = stash_pop_args.to_request(parsed)

	if (request === undefined) return refuse()

	try {
		return await answer(request)
	} catch (error) {
		return report_unknown(error)
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const stash_pop_cli = {
	AMBIGUOUS_VERDICT,
	CONFLICTED_VERDICT,
	NO_MATCH_VERDICT,
	POPPED_VERDICT,
	main,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { stash_pop_cli }
