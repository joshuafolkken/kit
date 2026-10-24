import { main_merge_guard } from '#scripts/git/main-merge-guard'
import { error_text } from '#scripts/lib/error-message'
import { git_stash } from './git-stash'
import { stash_args, type Request } from './stash-args'

// `josh stash:push "<message>"` — the one way a workflow sets its working tree aside, paired with
// `josh stash:pop "<message>"` that brings it back. Two rules fix what it takes:
//
// - **Untracked files go with it (`-u`).** Work in progress almost always includes a new, untracked
//   `*.test.ts`; a stash that leaves it behind leaves it for the next `pnpm josh ms` to refuse.
// - **The observation ledger stays** — every path `observation_ledger.is_ledger_path` names, legacy
//   ones included (`git_stash.STASHABLE_PATHSPEC`). A run appends its own lines to `.josh/observations/` and they
//   ride on that run's commit; a stash would take them off the tree before the commit or the
//   batch-end flush could see them.
//
// A tree with nothing outside the ledger to set aside pushes nothing and says `clean`, so a procedure
// can call it unconditionally and pop only after `stashed`.

const COMMAND = 'stash:push'
const STASH_RERUN = 'the command that stashed (`run:pause`, `stash:push`, `latest:if-required`)'

const STASHED_VERDICT = 'stashed'
const CLEAN_VERDICT = 'clean'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

function report(verdict: string, detail: string): number {
	console.info(verdict)
	console.error(detail)

	return SUCCESS_EXIT_CODE
}

function refuse(): number {
	console.error(stash_args.usage(COMMAND))

	return FAILURE_EXIT_CODE
}

type PushVerdict = typeof STASHED_VERDICT | typeof CLEAN_VERDICT

// The decision and the push without the printing, so a caller that chains a pop on `stashed`
// (`josh latest:if-required`) reads the verdict instead of parsing stdout.
// An index with unresolved paths is refused before the push: `git stash` cannot set them aside, and
// the way out is closing the merge, not a stash (joshuafolkken/kit#4769).
async function set_aside(request: Request): Promise<PushVerdict> {
	const unmerged = await git_stash.unmerged_paths(request.dir)

	if (unmerged.length > 0) {
		throw new Error(main_merge_guard.unresolved_message(COMMAND, unmerged, STASH_RERUN))
	}

	if (!(await git_stash.has_stashable_changes(request.dir))) return CLEAN_VERDICT

	await git_stash.push(request.message, request.dir, git_stash.STASHABLE_PATHSPEC)

	return STASHED_VERDICT
}

async function answer(request: Request): Promise<number> {
	if ((await set_aside(request)) === CLEAN_VERDICT) {
		return report(CLEAN_VERDICT, 'Nothing to stash.')
	}

	return report(STASHED_VERDICT, `Stashed as "${request.message}".`)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = stash_args.read_arguments(argv)
	const request = parsed === undefined ? undefined : stash_args.to_request(parsed)

	if (request === undefined) return refuse()

	try {
		return await answer(request)
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE_EXIT_CODE
	}
}

const stash_push_cli = { CLEAN_VERDICT, STASHED_VERDICT, run, set_aside }

export { stash_push_cli }
