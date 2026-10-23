import { stamp_file } from '#scripts/josh/stamp-file'
import {
	lane_session_action,
	type BrokerAnswer,
	type ReviewRound,
} from '#scripts/lane/lane-session-action'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'

// A lane child's reviewers started by the lane's broker (`run-ship-reviewer.ts`). `/code-review` alone
// omits `slots`, so a broker still on the code before them reads the request.
//
// **A broker that cannot read `slots` still reviews every slot**: the supervisor reloads on new code
// only at its next pass boundary (`run-wake-code.ts`), so the ship that first runs both reviews together
// meets a broker that never learned them (joshuafolkken/kit#4672). Each slot then goes in turn as a
// `/code-review` request — its brief staged at the code slot's file, its findings moved to its own — and
// the code slot goes last, with its own brief put back.

const { CODE } = review_attest.REVIEW_SLOT

function copy_stamp(source: string, target: string): void {
	const text = stamp_file.read_stamp_text(source)

	if (text !== undefined) stamp_file.write_text_stamp(target, text)
}

async function code_request(
	directory: string,
	issue: string,
	round: ReviewRound,
): Promise<BrokerAnswer> {
	return await lane_session_broker.request(directory, issue, { kind: 'review', round })
}

async function staged_review(
	directory: string,
	issue: string,
	round: ReviewRound,
	slot: ReviewSlot,
): Promise<BrokerAnswer> {
	const code = lane_session_broker.review_paths(directory)
	const own = lane_session_broker.review_paths(directory, slot)

	copy_stamp(own.brief, code.brief)
	const answer = await code_request(directory, issue, round)

	copy_stamp(code.findings, own.findings)
	stamp_file.remove_stamp(code.findings)

	return answer
}

// One after another, since every slot shares the code slot's files.
async function staged_reviews(
	directory: string,
	issue: string,
	round: ReviewRound,
	slots: ReadonlyArray<ReviewSlot>,
): Promise<ReadonlyArray<BrokerAnswer>> {
	const [slot, ...rest] = slots
	if (slot === undefined) return []

	const answer = await staged_review(directory, issue, round, slot)

	return [answer, ...(await staged_reviews(directory, issue, round, rest))]
}

async function in_turn(
	directory: string,
	issue: string,
	round: ReviewRound,
	slots: ReadonlyArray<ReviewSlot>,
): Promise<BrokerAnswer> {
	const code_brief = lane_session_broker.review_paths(directory).brief
	const kept = stamp_file.read_stamp_text(code_brief)
	const others = slots.filter((slot) => slot !== CODE)
	const answers = [...(await staged_reviews(directory, issue, round, others))]

	if (kept !== undefined) stamp_file.write_text_stamp(code_brief, kept)
	if (slots.includes(CODE)) answers.push(await code_request(directory, issue, round))

	return answers.find((answer) => !answer.is_success) ?? lane_session_action.SUCCESS
}

async function request(
	directory: string,
	issue: string,
	round: ReviewRound,
	slots: ReadonlyArray<ReviewSlot>,
): Promise<BrokerAnswer> {
	if (slots.length === 1 && slots[0] === CODE) return await code_request(directory, issue, round)

	const answer = await lane_session_broker.request(directory, issue, {
		kind: 'review',
		round,
		slots,
	})

	if (!lane_session_broker.is_unreadable(answer)) return answer

	return await in_turn(directory, issue, round, slots)
}

const run_ship_brokered_review = { request }

export { run_ship_brokered_review }
