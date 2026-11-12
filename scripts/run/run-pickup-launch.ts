import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'

// The launch half of `josh run:pickup <epic>...`: asks `epic:next --lanes` which children the epics
// offer and starts a lane per child with `lane:launch`, one printed line per outcome. Both are shelled
// out to, so the offer and the launch guards are reused rather than cloned. The launches run one
// after another, so each `lane:launch` reads the seats the one before it took.

const SUCCESS_EXIT_CODE = 0
const PNPM_LINE_MARKS = ['[ELIFECYCLE]', '$ ']
const UNREADABLE_REPO = 'epic:next not asked — the repository is unreadable'

interface PickupLaunch {
	lines: Array<string>
	is_refused: boolean
}

// The step's own last stderr line, past pnpm's own lines: the `$ <script>` echo of each nested
// `pnpm josh` call and the `[ELIFECYCLE]` note it appends to a failed command.
function is_pnpm_line(line: string): boolean {
	return PNPM_LINE_MARKS.some((mark) => line.startsWith(mark))
}

function reason(result: JoshResult): string {
	const lines = (result.err ?? '').split('\n').filter((line) => !is_pnpm_line(line))
	const last = lines.at(-1) ?? ''

	return last === '' ? `exit ${String(result.code)}` : last
}

async function launch_line(issue: string): Promise<string> {
	const result = await josh_command.josh_run(['lane:launch', issue], true)
	const cite = session_cite.issue(issue)

	if (result.code === SUCCESS_EXIT_CODE) return `${cite} launched — pid ${result.out}`

	return `${cite} not launched — ${reason(result)}`
}

// A token that is not an issue number is the verdict `epic:next` gave instead of a child —
// `wait`, `stop`, `complete` or `triage` — printed as it came.
async function offer_line(token: string): Promise<string> {
	if (!issue_number_shape.is_issue_number(token)) return `epic:next: ${token}`

	return await launch_line(token)
}

async function launch_offered(tokens: ReadonlyArray<string>): Promise<Array<string>> {
	const lines: Array<string> = []

	for (const token of tokens) {
		// eslint-disable-next-line no-await-in-loop -- each launch reads the seats the one before it took
		const line = await offer_line(token)

		lines.push(line)
	}

	return lines
}

async function launch(epics: ReadonlyArray<string>): Promise<PickupLaunch> {
	const repo = await git_gh_repo.repo_get_name_with_owner()

	if (repo === undefined) return { lines: [UNREADABLE_REPO], is_refused: true }

	const offer = await josh_command.josh_run(
		['epic:next', ...epics, '--repo', repo, '--lanes'],
		true,
	)

	if (offer.code !== SUCCESS_EXIT_CODE) {
		return { lines: [`epic:next refused — ${reason(offer)}`], is_refused: true }
	}

	const tokens = offer.out.split('\n').filter((token) => token !== '')

	return { lines: await launch_offered(tokens), is_refused: false }
}

const run_pickup_launch = { launch }

export type { PickupLaunch }
export { run_pickup_launch }
