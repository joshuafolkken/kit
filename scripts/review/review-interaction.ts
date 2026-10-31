import { project_checks } from '#scripts/gate/project-checks'
import { changed_paths } from '#scripts/git/changed-paths'
import { session_cite } from '#scripts/issue/session-cite'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { review_attest, type ReviewSlot } from './review-attest'
import { review_finding_ledger } from './review-finding-ledger'

// The interaction review — one adversarial pass after `/code-review`, over a change to the run
// tooling (joshuafolkken/kit#4276).
//
// **`/code-review` reads the diff for its own correctness, and the defects came from elsewhere**: most
// of them were a new mechanism meeting an existing one — a pause meeting the next run, a count meeting
// the per-second repaint. This pass is given one role, to find the existing features the change
// breaks, and is due only where those meetings happen: the four directories below, in the kit
// repository alone — a consumer's own `scripts/run/` is not kit's run tooling.
//
// **Its round is its own ledger line, `- ri:`**, so the merge gate tells it apart from `/code-review`'s
// and `josh followup` refuses a due change that has none. The verdicts mirror `review_record.check`'s:
// `not-required` covers both a change outside the directories and a checkout that keeps no ledger.

const TARGET_DIRECTORIES = ['scripts/run/', 'scripts/lane/', 'scripts/backlog/', 'scripts/hooks/']

const NOT_DUE_LINE =
	'Interaction review not due: this is not the kit repository, or the change touches none of scripts/run/, scripts/lane/, scripts/backlog/ or scripts/hooks/.'

const ROLE_LINES = [
	'## Interaction review',
	'This pass is not a second `/code-review`: do not hunt for bugs inside the diff — the round before it did. Your role is to find three existing features this change breaks. Check only these three:',
	'1. Every state, command, label, file or process this change adds or gives a new meaning to — who else reads or writes it? Search the repository outside the diff for each. Where the plan has a `### 影響を受ける既存の利用者` section, check it names them all.',
	'2. Does each of those readers and writers still behave correctly when the new state or value reaches it (for example, a paused lane counted as running)?',
	'3. Does the change add heavy or synchronous work to a path called repeatedly — every second, every Bash call, every edit?',
	"Report each break with the reader's `file:line` and the change's, rated by the rubric's severities; it is disposed of by `prompts/review.md` → \"Interaction review\".",
]

type InteractionStatus = 'ok' | 'missing' | 'not-required'

function due_paths(
	paths: ReadonlyArray<string>,
	checkout: string = process.cwd(),
): ReadonlyArray<string> {
	if (!project_checks.is_kit_repository(checkout)) return []

	return paths.filter((file) => TARGET_DIRECTORIES.some((directory) => file.startsWith(directory)))
}

function brief_block(targets: ReadonlyArray<string>): string {
	const listed = targets.map((file) => `- ${file}`)

	return [...ROLE_LINES, 'Changed in the run tooling:', ...listed].join('\n')
}

async function status_of(
	issue: number,
	paths: ReadonlyArray<string>,
	root: string = observation_ledger_home.ledger_root(),
): Promise<InteractionStatus> {
	const content = due_paths(paths).length > 0 ? await observation_ledger_home.read(root) : undefined

	if (content === undefined) return 'not-required'

	return review_finding_ledger.has_issue_record(content, issue, 'interaction') ? 'ok' : 'missing'
}

// The status over this checkout's change — the reading `review:brief` takes.
async function status(issue: number, root?: string): Promise<InteractionStatus> {
	return await status_of(issue, await changed_paths.read_changed_paths(false), root)
}

// **Round 1's slots — the interaction review beside `/code-review`'s where it is due and not yet
// recorded** (joshuafolkken/kit#4672, joshuafolkken/kit#4802), so it takes round 1's wait and stop.
// `josh ship` and `josh run:review` both open round 1 from it.
function round_one_slots(answer: InteractionStatus | undefined): ReadonlyArray<ReviewSlot> {
	const { CODE, INTERACTION } = review_attest.REVIEW_SLOT

	return answer === 'missing' ? [CODE, INTERACTION] : [CODE]
}

const MISSING_REASON =
	'This change touches the run tooling, and no interaction review is recorded for its issue — the pass that looks for the existing features a change breaks, which `/code-review` does not (joshuafolkken/kit#4276).'

const REMEDY =
	'Run it from `pnpm josh review:brief --interaction`, then record the findings its reviewer wrote with `pnpm josh review:submit --interaction` by `pnpm josh review:record --from-slot --interaction --issue <N> [<n>=<disposition> ...]` and reissue the merge.'

function refusal_message(issue: number): string {
	return [MISSING_REASON, `Issue: ${session_cite.issue(issue)}`, REMEDY].join('\n')
}

// The merge gate's half: the refusal for a due change with no recorded pass, else `undefined`.
async function refusal(issue: number, root?: string): Promise<string | undefined> {
	return (await status(issue, root)) === 'missing' ? refusal_message(issue) : undefined
}

const review_interaction = {
	brief_block,
	due_paths,
	NOT_DUE_LINE,
	refusal,
	refusal_message,
	round_one_slots,
	status,
	status_of,
}

export type { InteractionStatus }
export { review_interaction }
