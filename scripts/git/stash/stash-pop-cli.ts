import { error_text } from '#scripts/lib/error-message'
import { git_stash } from './git-stash'
import { stash_args, type Request } from './stash-args'

// `josh stash:pop "<message>"` — pop the stash whose message matches, and no other; `josh stash:pop
// <hash>` pops the entry with that commit hash, the way out of an ambiguous message.
// The stash stack is shared by every working tree of the repository, so a
// procedure that pops by position takes whatever another lane last pushed. This resolves the
// selector from the message and pops that entry alone; no match and more than one match are both
// refusals rather than a guess at which was meant.

const COMMAND = 'stash:pop'

const POPPED_VERDICT = 'popped'
const CONFLICTED_VERDICT = 'conflicted'
const NO_MATCH_VERDICT = 'no-match'
const AMBIGUOUS_VERDICT = 'ambiguous'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

function report(verdict: string, detail: string, code: number): number {
	console.info(verdict)
	console.error(detail)

	return code
}

function refuse(): number {
	console.error(stash_args.usage(COMMAND))

	return FAILURE_EXIT_CODE
}

// A pop that leaves unmerged paths applied the stash and only needs the conflicts resolved, so it is
// reported `conflicted` at exit 0 rather than raised as an unknown failure;
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

// Two entries pushed under one message are told apart by their commit hash, which never moves:
// the ambiguous refusal names each, and a hash given in place of the message pops that entry alone
// (joshuafolkken/kit#6979). A pushed message carries an issue and words, never bare hex, so the two
// forms do not collide.
const HASH_ARGUMENT = /^[\da-f]{7,40}$/u

async function ambiguous(request: Request): Promise<number> {
	const entries = await git_stash.list_by_hash(request.dir)
	const hashes = entries.filter((entry) => git_stash.matches(entry.subject, request.message))
	const named = hashes.map((entry) => entry.selector).join(', ')
	const detail = `More than one stash matches "${request.message}" — pop one by its hash: ${named}.`

	return report(AMBIGUOUS_VERDICT, detail, FAILURE_EXIT_CODE)
}

// The stack position of the one entry whose hash starts with `hash`, read immediately before the pop.
async function position_of_hash(
	hash: string,
	directory: string | undefined,
): Promise<string | undefined> {
	const entries = await git_stash.list_by_hash(directory)
	const [only, ...rest] = entries.filter((entry) => entry.selector.startsWith(hash))

	if (only === undefined || rest.length > 0) return undefined

	return await git_stash.position_of(only.selector, directory)
}

async function pop_hash(hash: string, directory: string | undefined): Promise<number> {
	const position = await position_of_hash(hash, directory)

	if (position === undefined) {
		return report(NO_MATCH_VERDICT, `No single stash has the hash ${hash}.`, FAILURE_EXIT_CODE)
	}

	return await pop_selected(position, directory)
}

async function answer(request: Request): Promise<number> {
	if (HASH_ARGUMENT.test(request.message)) return await pop_hash(request.message, request.dir)

	const selection = git_stash.select(await git_stash.list(request.dir), request.message)

	if (selection.kind === 'none') {
		return report(NO_MATCH_VERDICT, `No stash matches "${request.message}".`, FAILURE_EXIT_CODE)
	}

	if (selection.kind === 'ambiguous') return await ambiguous(request)

	return await pop_selected(selection.selector, request.dir)
}

function report_unknown(error: unknown): number {
	console.error(error_text.message_of(error))

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = stash_args.read_arguments(argv)

	if (parsed === undefined) return refuse()

	const request = stash_args.to_request(parsed)

	if (request === undefined) return refuse()

	try {
		return await answer(request)
	} catch (error) {
		return report_unknown(error)
	}
}

const stash_pop_cli = {
	AMBIGUOUS_VERDICT,
	CONFLICTED_VERDICT,
	NO_MATCH_VERDICT,
	POPPED_VERDICT,
	run,
}

export { stash_pop_cli }
