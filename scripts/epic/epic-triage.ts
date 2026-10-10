import { issue_cite } from '#scripts/issue/issue-cite'
import { has_label_name, RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { issue_citation } from '#scripts/rules/issue-citation'
import type { EpicChild } from './epic-graph'

// The triage gate on what a run is offered.
//
// `run:solo` records that an issue runs alone, but its absence said nothing:
// "judged safe beside others" and "never judged" looked the same, and an issue opted in mid-run reached
// `backlog:drive` without any agent reading it. `run:lane` records the other answer, so an issue with
// neither label is one nobody has judged — and such an issue may be one that must run alone.
//
// **One untriaged candidate withholds every candidate**, not just itself: whether the others may start
// depends on whether it is `run:solo`, which is exactly what is not known yet. The answer is the
// `triage` verdict, which `backlog:drive` hands back to the parent rather than acting on.
//
// **Both offer paths call `untriaged`**: `backlog:next` (the pool drain) and `epic:next --lanes`
// (a named epic's children, `epic-lane-offer.ts`) — the same pairing `epic_solo` keeps.

type TriageVerdict = 'triage'

const TRIAGE_VERDICT: TriageVerdict = 'triage'

// Read off a bare label list too, so `josh issue:file` refuses an untriaged `auto-ok` filing by the
// same answer the offer paths withhold it by.
function has_triage_label(labels: ReadonlyArray<string>): boolean {
	return has_label_name(labels, RUN_SOLO_LABEL) || has_label_name(labels, RUN_LANE_LABEL)
}

function is_triaged(child: EpicChild): boolean {
	return has_triage_label(child.labels)
}

// The candidates nobody has judged, in the order they were given.
function untriaged(children: ReadonlyArray<EpicChild>): ReadonlyArray<EpicChild> {
	return children.filter((child) => !is_triaged(child))
}

// Names every untriaged number, so the parent reading standard error knows which issues to judge.
function message(children: ReadonlyArray<EpicChild>, repo: string): string {
	const numbers = children.map((child) => issue_cite.plain(child.number)).join(', ')

	return issue_citation.linkify(
		`Untriaged: ${numbers} carry neither \`${RUN_SOLO_LABEL}\` nor \`${RUN_LANE_LABEL}\` in ${repo}, so nothing is offered until each is judged. Read each one, record its blocked-by order and one of the two labels with a comment saying why, then ask again.`,
		repo,
	)
}

const epic_triage = { TRIAGE_VERDICT, has_triage_label, is_triaged, message, untriaged }

export type { TriageVerdict }
export { epic_triage }
