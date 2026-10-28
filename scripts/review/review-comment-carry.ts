import { error_text } from '#scripts/lib/error-message'
import { review_comment_round } from './review-comment-round'

// The carry of the closed issues' comment rounds as its two callers run it — `review:record` outside a
// lane, and `observations:flush` for the lanes (joshuafolkken/kit#5326) — so both print the same
// lines. **A carry that fails never fails its caller**: the rounds wait for the next carry, and the
// carried file is the mark, so nothing is copied twice.

const CARRIED_LINE =
	'review-finding line(s) recorded on closed issues after their pull requests opened into the ledger.'
const CARRY_FAILED_LINE =
	'Could not carry the closed issues’ comment rounds into the ledger; the next carry retries:'

async function carry_reported(root: string): Promise<void> {
	try {
		const count = await review_comment_round.carry(root)

		if (count > 0) console.info(`Carried ${String(count)} ${CARRIED_LINE}`)
	} catch (error) {
		console.warn(`${CARRY_FAILED_LINE} ${error_text.message_of(error)}`)
	}
}

const review_comment_carry = {
	CARRIED_LINE,
	CARRY_FAILED_LINE,
	carry_reported,
}

export { review_comment_carry }
