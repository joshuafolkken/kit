import { issue_cite } from '#scripts/issue/issue-cite'
import type { BacklogIssue } from './epic-bundle'

// The epic an `ask` answer recommends, and the decision record `--apply` writes when it places the
// issue there. Choosing between peer epics is Tier A (`epic-commands`), so the choice is made here
// once rather than by each caller, and its reasoning is recorded with the placement.
//
// The rule is the one a reader would apply by hand: the epic already tracking the most related issues
// is where the work sits; on a tie, the older epic — the lower number — was there first.

interface PlacementInput {
	subject: number
	epic: number
	epics: ReadonlyArray<number>
	// The backlog rows of the candidates, whose `epic` is what is counted.
	members: ReadonlyArray<BacklogIssue>
}

function tracked_count(epic: number, members: ReadonlyArray<BacklogIssue>): number {
	return members.filter((member) => member.epic === epic).length
}

function recommend_epic(
	epics: ReadonlyArray<number>,
	members: ReadonlyArray<BacklogIssue>,
): number | undefined {
	const [recommended] = epics.toSorted(
		(left, right) => tracked_count(right, members) - tracked_count(left, members) || left - right,
	)

	return recommended
}

function format_counts(epics: ReadonlyArray<number>, members: ReadonlyArray<BacklogIssue>): string {
	return epics
		.map(
			(epic) => `${issue_cite.plain_for('github', epic)}: ${String(tracked_count(epic, members))}`,
		)
		.join(', ')
}

// Taken, rejected, why and the date — what `epic-commands` asks a placement record to carry.
function placement_record(input: PlacementInput, date: string): string {
	const rejected = input.epics
		.filter((epic) => epic !== input.epic)
		.map((epic) => issue_cite.plain_for('github', epic))
	const placed = `placed ${issue_cite.plain_for('github', input.subject)} in ${issue_cite.plain_for('github', input.epic)}`
	const counts = format_counts(input.epics, input.members)

	return `Auto-decided (${date}, \`epic:bundle --apply\`): ${placed} over ${rejected.join(', ')} because it tracks the most related issues (${counts}); a tie goes to the older epic.`
}

const epic_bundle_recommend = { recommend_epic, placement_record }

export { epic_bundle_recommend }
export type { PlacementInput }
