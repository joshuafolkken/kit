import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_pr_rest } from '#scripts/gh/git-gh-pr-rest'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { has_label_name, NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, Overlay, RowReason } from './run-board-layout'

// The current open listing owns this wait; an old launch or park must not hide it.
function is_waiting(plan: BoardPlan, issue: number): boolean {
	return (
		plan.context.open_numbers?.has(issue) !== false &&
		has_label_name(plan.labels.get(issue) ?? [], NEEDS_HUMAN_MERGE_LABEL)
	)
}

function has_waiting(plan: BoardPlan): boolean {
	for (const issue of plan.labels.keys()) {
		if (is_waiting(plan, issue)) return true
	}

	return false
}

async function read_prs(plan: BoardPlan): Promise<ReadonlyMap<number, number>> {
	if (!has_waiting(plan)) return new Map()
	const json = await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.pulls_api_path(plan.context.repo)}?state=open&per_page=100`,
		should_paginate: true,
	})
	const pulls = git_gh_pr_rest.parse_rest_pulls(json)
	const pairs = pulls.flatMap((pull) => {
		const issue = Number(git_closes_keyword.parse_closes_issue_number(pull.body ?? undefined))

		return is_waiting(plan, issue) ? [[issue, pull.number] as const] : []
	})

	return new Map(pairs)
}

function reason_of(child: EpicChild, plan: BoardPlan): RowReason | undefined {
	if (child.state !== 'OPEN' || !is_waiting(plan, child.number)) return undefined
	const pr = plan.human_merge_prs?.get(child.number)

	return {
		icon: run_board_labels.WAIT_ICONS.human_merge,
		value: pr === undefined ? undefined : `PR ${String(pr)}`,
	}
}

async function with_prs(plan: BoardPlan | undefined): Promise<BoardPlan | undefined> {
	return plan === undefined ? undefined : { ...plan, human_merge_prs: await read_prs(plan) }
}

function waiting_children(plan: BoardPlan): Array<EpicChild> {
	const { waves } = plan
	const all = [...waves.waves.flat(), ...waves.unreached, ...(waves.running ?? [])]

	return all.filter(
		(child) =>
			child.state === 'OPEN' &&
			is_waiting(plan, child.number) &&
			!plan.occupied_lanes?.includes(String(child.number)),
	)
}

// Only workers that released their seat move into the human-merge waiting section.
function overlay_of(
	plan: BoardPlan,
	statuses: Overlay['statuses'],
): Overlay & { waiting_numbers: ReadonlySet<number> } {
	const { waves } = plan
	const held = waiting_children(plan)
	const numbers = new Set(held.map((child) => child.number))
	const hidden = new Set([...numbers, ...(plan.occupied_lanes ?? []).map(Number)])
	const next = {
		...waves,
		...(waves.running !== undefined && {
			running: waves.running.filter((child) => !numbers.has(child.number)),
		}),
		waves: waves.waves.map((wave) => wave.filter((child) => !hidden.has(child.number))),
		unreached: [...waves.unreached.filter((child) => !hidden.has(child.number)), ...held],
	}

	return {
		waiting_numbers: numbers,
		plan: { ...plan, waves: next },
		statuses: new Map([...statuses].filter(([issue]) => !numbers.has(issue))),
	}
}

const run_board_human_merge = { overlay_of, read_prs, reason_of, with_prs }

export { run_board_human_merge }
