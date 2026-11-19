import type { EpicChild } from '#scripts/epic/epic-graph'
import { PLANNED_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, RowReason } from './run-board-layout'
import { run_board_reason } from './run-board-reason'

// joshuafolkken/kit#7572: a row whose filing has not published stood at `⏳` with an empty reason,
// while `backlog:next` withheld it for exactly that.

const REPO = 'joshuafolkken/kit'
const ROW = 7572
const BLOCKER = 7559
const NOW_MS = Date.parse('2026-11-15T00:00:00.000Z')
const { WAIT_ICONS, WAIT_WORDS, WORDS } = run_board_labels
const PENDING_BODY = issue_publication_state.prepare('## 背景\n', [RUN_LANE_LABEL])

const EPIC = 7500
const EPIC_PLACEMENT = {
	icon: WAIT_ICONS.publication,
	tail: '→ epic placement: add it to an epic task list',
}

function row(
	body: string,
	blocked_by: EpicChild['blocked_by'] = [],
	labels: ReadonlyArray<string> = [RUN_LANE_LABEL],
): EpicChild {
	return { number: ROW, repo: REPO, state: 'OPEN', labels, blocked_by, body }
}

function plan_of(children: Array<EpicChild>, epic?: number): BoardPlan {
	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(epic === undefined ? [] : [[ROW, epic]]),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([ROW]) },
		labels: new Map(),
	}
}

function reason(
	child: EpicChild,
	waits: ReadonlyArray<string> = [],
	epic?: number,
): RowReason | undefined {
	const read = {
		plan: plan_of([child], epic),
		statuses: new Map(),
		events: [],
		free_lanes: 1,
		is_stopped: false,
		now_ms: NOW_MS,
	}

	return run_board_reason.reader(read)(child, waits)
}

// joshuafolkken/kit#8174: #8114, pending in no epic, stood at a bare `📰` nobody acted on.
it('leads a pending row in no epic with 📰 and the epic placement step', () => {
	expect(reason(row(PENDING_BODY))).toStrictEqual(EPIC_PLACEMENT)
})

it('names the plan record command for a pending child with no recorded plan', () => {
	expect(reason(row(PENDING_BODY), [], EPIC)).toStrictEqual({
		icon: WAIT_ICONS.publication,
		tail: `→ plan record: pnpm josh issue:plan ${String(ROW)} --planned`,
	})
})

it('names the epic publish command once a planned child sits in its epic', () => {
	const planned = row(PENDING_BODY, [], [RUN_LANE_LABEL, PLANNED_LABEL])

	expect(reason(planned, [], EPIC)).toStrictEqual({
		icon: WAIT_ICONS.publication,
		tail: `→ publish: pnpm josh issue:file --publish ${String(EPIC)}`,
	})
})

it('says publication before a blocker the row also waits on', () => {
	const blocked = row(PENDING_BODY, [{ number: BLOCKER, repo: REPO }])

	expect(reason(blocked, [String(BLOCKER)])).toStrictEqual(EPIC_PLACEMENT)
})

it('says nothing of publication once the filing has published', () => {
	const published = issue_publication_state.public_body(PENDING_BODY)

	expect(reason(row(published))).toBeUndefined()
})

it('names 📰 in the legend as a pending publication', () => {
	const words = new Map(WAIT_WORDS.map(([icon, word]) => [icon, WORDS[word]]))

	expect(words.get(WAIT_ICONS.publication)).toBe('publication pending')
})
