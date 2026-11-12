import { epic_busy } from '#scripts/epic/epic-busy'
import {
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { run_add, type AddPorts } from '#scripts/run/add/run-add'
import { run_board_status } from '#scripts/run/board/run-board-status'
import { describe, expect, it } from 'vitest'
import { issue_run_hold } from './issue-run-hold'

// joshuafolkken/kit#6535: on #6498 `lane:list`, `run:add --retry` and the board answered "is it
// in progress" differently for the same labels. Each now reads `issue_run_hold`, so each answers it
// the same.

const ISSUE = 6498
const RETRY = { is_retry: true, done: [], active: new Set<string>() }

function lane_list_holds(labels: ReadonlyArray<string>): boolean {
	const row = { number: ISSUE, title: 'Child', labels: labels.map((name) => ({ name })) }
	const read = epic_busy.parse_listing(JSON.stringify([{ ...row, createdAt: '' }]), false)

	return read.kind === 'busy'
}

async function run_add_holds(labels: ReadonlyArray<string>): Promise<boolean> {
	const ports: AddPorts = {
		read_issue: async () => await { is_open: true, labels, blockers: [] },
		apply_label: async () => true,
		clear_label: async () => true,
	}
	const [outcome] = await run_add.add_all([ISSUE], false, ports, RETRY)

	return outcome?.kind === 'refused' && outcome.reason === IN_PROGRESS_LABEL
}

function board_holds(labels: ReadonlyArray<string>): boolean {
	const statuses = new Map([[ISSUE, { state: 'running' as const, started_ms: 0 }]])
	const read = {
		open_numbers: new Set([ISSUE]),
		read_ms: 1,
		closed: new Map(),
		labels: new Map([[ISSUE, labels]]),
	}

	return run_board_status.settle_closed(statuses, read).get(ISSUE)?.state === 'running'
}

describe('issue_run_hold.is_held — one answer for every reader', () => {
	it.each<[string, ReadonlyArray<string>, boolean]>([
		['in progress', [IN_PROGRESS_LABEL], true],
		['in progress whatever its case', [IN_PROGRESS_LABEL.toUpperCase()], true],
		['stalled, still labelled in progress', [IN_PROGRESS_LABEL, RUN_STALLED_LABEL], false],
		['parked on a decision', [IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL], false],
		['unlabelled', [], false],
	])('answers alike for an issue %s', async (_label, labels, is_held) => {
		expect(issue_run_hold.is_held(labels)).toBe(is_held)
		expect(lane_list_holds(labels)).toBe(is_held)
		expect(await run_add_holds(labels)).toBe(is_held)
		expect(board_holds(labels)).toBe(is_held)
	})
})
