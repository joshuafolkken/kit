import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { run_ship_probe } from '#scripts/run/ship/run-ship-probe'
import { review_comment_round } from './review-comment-round'
import type { Finding } from './review-finding-ledger'
import { review_record_code_round } from './review-record-code-round'

// The issue-comment half of `josh review:record`: a round kept on the issue rather than in the
// observation ledger (`review-comment-round.ts` carries it there once the issue closes).

const FAILURE_EXIT_CODE = 1
const AFTER_PUSH_LINE =
	'The branch is pushed and the tree is clean, so this round is recorded on the issue, not in the ledger — a ledger line would need a push of its own and restart CI.'

interface CommentRound {
	issue: number
	lines: ReadonlyArray<string>
	root: string
	findings: ReadonlyArray<Finding>
}

// **A comment that could not be posted fails the record**: it is the round's only copy, so a
// swallowed refusal would read as a recorded round that exists nowhere.
async function post(issue: number, lines: ReadonlyArray<string>): Promise<number> {
	try {
		const url = await git_gh_issue_write.issue_comment(
			String(issue),
			review_comment_round.body_of(lines),
		)

		console.info(`Recorded ${String(lines.length)} review-finding line(s) in ${url.trim()}.`)

		return 0
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))

		return FAILURE_EXIT_CODE
	}
}

// **A code round recorded once the branch is pushed and the tree clean goes to the issue unasked**
// (joshuafolkken/kit#4907): `josh run:review` pushed at the first green gate, and a ledger line now
// would ride no commit of the run's but a push of its own, restarting CI. `--check` reads the issue's
// comment rounds too (`review-record.ts`). The round still stamps its tree, so `josh ship` reuses it
// as round 1.
async function is_after_push(): Promise<boolean> {
	return await run_ship_probe.is_pushed_clean()
}

async function post_after_push(round: CommentRound): Promise<number> {
	console.info(AFTER_PUSH_LINE)
	const code = await post(round.issue, round.lines)

	if (code === 0) await review_record_code_round.follow(round.issue, round.root, round.findings)

	return code
}

const review_record_comment = { is_after_push, post, post_after_push }

export { review_record_comment }
