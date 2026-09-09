import { release_history, type HistoryReader } from '#scripts/release/release-history'
import { release_plan } from '#scripts/release/release-plan'
import { version_targets } from '#scripts/version/version-targets'
import { git_command } from './git-command'

// What the completion notification says about versions, now that children do not set one
// (joshuafolkken/kit#1486).
//
// **It used to read `package.json` and print `📦 project version: <v>`.** While every child ran
// `pnpm josh bump minor` that value was this run's shipping version. Children no longer bump — the
// version is decided from main's history by `pnpm josh release` — so the same read now returns the
// **previous** release, and printing it presents an unconfirmed shipping version as a fact.
//
// **What goes out instead is the number a release is made of**: how many merges main has taken since
// the version last changed. It is the count `pnpm josh release` itself acts on, taken from that
// command's own modules rather than re-derived here, and it doubles as the visible signal that a
// release is owed — a count that keeps climbing is a release nobody has run.

// **The Telegram is sent before the merge**, deliberately: `git-pr-followup.ts` cuts its wrap-up
// there because that is the last point at which the run can still fail safely. So the count taken
// there cannot include this run's own merge, and a bare number would be understated by exactly one.
// Saying so is the honest form of the same measurement. The console line printed after the merge
// passes `false` and carries no note, because by then the merge is on the remote and the fetch below
// brings it in; `scripts-ai/git-followup-finish.ts` is that caller, so **both branches of this flag
// are live**. What a run *does* about the count is `pnpm josh release:scope`, asked after the merge,
// which reads `read_pending` below rather than this line (joshuafolkken/kit#1582).
const MERGE_PENDING_NOTE = "— this run's merge is not counted; it lands next"

interface PendingReadOptions {
	cwd?: string
	reader?: HistoryReader
	// Only a test passes this. Production always resolves the tip itself, so no caller can quietly
	// point the count at a ref that is not main's.
	tip?: string
}

// **The note belongs to the line, not to the count** (joshuafolkken/kit#1582). `read_pending`
// returns a number and has no sentence to annotate, so `pnpm josh release:scope` — which wants the
// number alone — would otherwise have to pass a flag about wording it never prints.
interface PendingLineOptions extends PendingReadOptions {
	is_merge_pending: boolean
}

// **The count is read from the fetched default branch, never from `HEAD`.** `followup` runs on the
// feature branch, and `--first-parent` from a branch tip walks that branch rather than main — every
// merge main took after the branch was cut is not even an ancestor, so the number would be silently
// low and the line still say "on main". Fetching first is what makes it current, which is also what
// lets the post-merge console line — and `pnpm josh release:scope`, asked from a lane or a feature
// branch — count the merge that just landed (joshuafolkken/kit#1582).
async function read_tip(options: PendingReadOptions): Promise<string> {
	if (options.tip !== undefined) return options.tip

	const default_branch = await git_command.get_default_branch()

	await git_command.fetch_branch(default_branch)

	return `origin/${default_branch}`
}

// **Undefined rather than a line reading zero.** A version that cannot be read, a fetch that could
// not run, or a history whose base the search cannot resolve is not "nothing is waiting to ship" —
// and a notification that said so would be the same class of false statement this module exists to
// remove.
// The manifest read is **inside** the `try` with the rest. `readFileSync` can throw after
// `existsSync` passed — EACCES, EISDIR, a racing write — and this function is called from
// `notify_completion`, which runs *before* `pr_merge`: an escaping rejection there would abort the
// run and lose a merge over a cosmetic line.
async function read_pending(options: PendingReadOptions): Promise<number | undefined> {
	try {
		const current_version = version_targets.read_workspace_version(options.cwd ?? process.cwd())

		if (current_version === undefined) return undefined

		const tip = await read_tip(options)
		const plan = await release_history.read_release_plan(current_version, options.reader, tip)

		return plan?.pending
	} catch {
		return undefined
	}
}

async function pending_release_line(options: PendingLineOptions): Promise<string | undefined> {
	const pending = await read_pending(options)

	if (pending === undefined) return undefined

	const line = release_plan.format_pending_line(pending)

	return options.is_merge_pending ? `${line} ${MERGE_PENDING_NOTE}` : line
}

const git_followup_pending = { MERGE_PENDING_NOTE, pending_release_line, read_pending }

export { git_followup_pending }
export type { PendingLineOptions, PendingReadOptions }
