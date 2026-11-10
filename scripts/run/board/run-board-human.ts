import { issue_human_stops } from '#scripts/issue/issue-human-stops'
import {
	ALREADY_DONE_LABEL,
	has_label_name,
	NEEDS_HUMAN_MERGE_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
} from '#scripts/issue/issue-labels'

// joshuafolkken/kit#7097: the board's 🙋 state (`human`) — a stop waiting on a person — is read from the
// human-stop registry (`issue-human-stops.ts`), so a stop added there is drawn as one without a board
// change. A registry label the board draws elsewhere is named here with where.
const DRAWN_ELSEWHERE: ReadonlyMap<string, string> = new Map([
	[NEEDS_HUMAN_MERGE_LABEL, 'the merge wait (`run-board-human-merge.ts`)'],
	[ALREADY_DONE_LABEL, 'the done section (joshuafolkken/kit#7095)'],
	[NEEDS_HUMAN_REVIEW_LABEL, 'nowhere: it withholds the commit, not the lane'],
])

function human_labels(): ReadonlyArray<string> {
	return [...issue_human_stops.labels()].filter((label) => !DRAWN_ELSEWHERE.has(label))
}

// Whether label names carry a stop that waits on a person.
function is_human(labels: ReadonlyArray<string>): boolean {
	return human_labels().some((label) => has_label_name(labels, label))
}

// A park waiting on a person's decision (joshuafolkken/kit#4099) — the one answer the 🙋 decision
// section and the findings section read a park reason by.
function is_decision(reason: string | undefined): boolean {
	if (reason === undefined) return false

	return human_labels().some((label) => reason.includes(label))
}

const run_board_human = { DRAWN_ELSEWHERE, human_labels, is_decision, is_human }

export { run_board_human }
