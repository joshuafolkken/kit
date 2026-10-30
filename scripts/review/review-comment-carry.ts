import { rmSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { review_comment_round } from './review-comment-round'

// The carry of the closed issues' comment rounds as its two callers run it — `review:record` outside a
// lane, and `observations:flush` for the lanes (joshuafolkken/kit#5326) — so both print the same
// lines. **A carry that fails never fails its caller**: the rounds wait for the next carry, and the
// carried file is the mark, so nothing is copied twice.

const CARRIED_LINE =
	'review-finding line(s) recorded on closed issues after their pull requests opened into the ledger.'
const CARRY_FAILED_LINE =
	'Could not carry the closed issues’ comment rounds into the ledger; the next carry retries:'
const LANE_CARRY_LINE =
	'Not carrying the closed issues’ comment rounds: a lane leaves them to `pnpm josh observations:flush`.'
const UNKNOWN_CHECKOUT_LINE =
	'Not carrying the closed issues’ comment rounds: Git could not identify this checkout; `pnpm josh observations:flush` carries them later.'
const GIT_DIRECTORY_COUNT = 2
const UNTRACKED_PREFIX = '?? '

// **A carried file no commit took is discarded before the default branch catches up**: left untracked
// by a flush that stopped after its carry, it would make git refuse that fast-forward on every later
// flush. Nothing is lost — the carry regenerates it from the issue's comments.
function discard_uncommitted(status_output: string, root: string): void {
	const untracked = status_output.split('\n').filter((line) => line.startsWith(UNTRACKED_PREFIX))
	const carried = untracked
		.map((line) => observation_ledger.status_path(line))
		.filter((file_path) => review_comment_round.is_carried_file(file_path))

	for (const file_path of carried) rmSync(path.join(root, file_path), { force: true })
}

async function carry_reported(root: string): Promise<void> {
	try {
		const count = await review_comment_round.carry(root)

		if (count > 0) console.info(`Carried ${String(count)} ${CARRIED_LINE}`)
	} catch (error) {
		console.warn(`${CARRY_FAILED_LINE} ${error_text.message_of(error)}`)
	}
}

// joshuafolkken/kit#5442: unmarked linked lanes also leave other issues' rounds to the flush.
// Only a known primary checkout carries here; a failed probe never permits a carry.
async function carry_from_record(root: string): Promise<void> {
	const directories = lane_child_marker.is_child_of(root)
		? undefined
		: git_common_directory.directories(root)

	if (directories === undefined || git_common_directory.select_linked(directories) !== undefined) {
		console.info(LANE_CARRY_LINE)

		return
	}

	if (directories.length !== GIT_DIRECTORY_COUNT) {
		console.warn(UNKNOWN_CHECKOUT_LINE)

		return
	}

	await carry_reported(root)
}

const review_comment_carry = {
	CARRIED_LINE,
	CARRY_FAILED_LINE,
	carry_reported,
	carry_from_record,
	discard_uncommitted,
}

export { review_comment_carry }
