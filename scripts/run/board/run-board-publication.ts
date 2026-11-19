import type { EpicChild } from '#scripts/epic/epic-graph'
import {
	issue_publication_state,
	type PublicationStep,
} from '#scripts/issue/issue-publication-state'
import { run_board_labels } from './run-board-labels'
import type { RowReason } from './run-board-layout-types'

// `📰`: an issue whose filing has not published yet (`issue-publication-state.ts`), which no pickup
// offers until it does (joshuafolkken/kit#7572). The row names the first step it still lacks and the
// command that takes it (joshuafolkken/kit#8174): an issue in no epic or with no recorded plan stays
// pending however long it waits, so the bare icon left nobody to act.

const { WAIT_ICONS } = run_board_labels

function hint_of(step: PublicationStep, number: number, epic: number | undefined): string {
	if (step === 'epic placement') return 'epic placement: add it to an epic task list'
	if (step === 'plan record') return `plan record: pnpm josh issue:plan ${String(number)} --planned`

	return `publish: pnpm josh issue:file --publish ${String(epic)}`
}

// What the row says for a pending child, given the epic that tracks it, if any; `undefined` once it
// has published.
function reason_of(child: EpicChild, epic: number | undefined): RowReason | undefined {
	const [step] = issue_publication_state.missing_steps({
		body: child.body,
		labels: child.labels,
		has_epic: epic !== undefined,
	})

	if (step === undefined) return undefined

	return { icon: WAIT_ICONS.publication, tail: `→ ${hint_of(step, child.number, epic)}` }
}

const run_board_publication = { reason_of }

export { run_board_publication }
