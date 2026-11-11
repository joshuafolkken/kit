import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_cite } from '#scripts/issue/issue-cite'
import { has_label_name, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_not_before } from '#scripts/issue/issue-not-before'

// Why the backlog had nothing to offer while children ran (joshuafolkken/kit#4513): which waiting
// issues wait on a dependency chain, and which on a declared start condition (a start date or a
// sample condition, `issue-not-before.ts`), so `lane:stats` splits `offer:watch:blocked` by cause instead of reporting one row.
//
// `backlog:next` writes one line per cause on standard error and `backlog:offer` reads them back, the
// way the `run:solo` notice travels; both sides go through this module so the spelling cannot drift.
// A child carrying `in-progress` is the running work itself, not a wait it causes, so it is left out.

type WaitCause = 'chain' | 'gate'

type WaitCauses = Readonly<Record<WaitCause, ReadonlyArray<number>>> & {
	not_before_ms?: number
}

const CAUSES: ReadonlyArray<WaitCause> = ['chain', 'gate']
const MARKS: Readonly<Record<WaitCause, string>> = {
	chain: 'Waiting on a dependency chain:',
	gate: 'Waiting on a start condition:',
}
const TAG_SEPARATOR = '+'
const ISSUE_PATTERN = /#(\d+)/gu
const CLOSED_STATE = 'CLOSED'
const DEADLINE_MARK = 'Next start time: '

// `blocked_by` keeps a relation after its blocker closes, so a candidate the overlap separation moved
// to `waiting` would read as a chain on the closed relation alone.
function has_open_blocker(child: EpicChild): boolean {
	return child.blocked_by.some((blocker) => blocker.state !== CLOSED_STATE)
}

function cause_of(child: EpicChild): WaitCause | undefined {
	if (has_label_name(child.labels, IN_PROGRESS_LABEL)) return undefined
	if (!issue_not_before.is_due(child.body)) return 'gate'

	return has_open_blocker(child) ? 'chain' : undefined
}

function deadline_of(children: ReadonlyArray<EpicChild>): { not_before_ms?: number } {
	const dates = children
		.filter((child) => cause_of(child) === 'gate')
		.map((child) => issue_not_before.waiting_ms(child.body))
		.filter((date): date is number => date !== undefined)

	return dates.length === 0 ? {} : { not_before_ms: Math.min(...dates) }
}

function numbers_with(children: ReadonlyArray<EpicChild>, cause: WaitCause): Array<number> {
	return children.filter((child) => cause_of(child) === cause).map((child) => child.number)
}

// This repository's waiting children by cause; a child elsewhere is not work this checkout could start.
function classify(children: ReadonlyArray<EpicChild>, repo: string): WaitCauses {
	const here = children.filter((child) => child.repo === repo)

	return {
		chain: numbers_with(here, 'chain'),
		gate: numbers_with(here, 'gate'),
		...deadline_of(here),
	}
}

function cited(numbers: ReadonlyArray<number>): string {
	return numbers.map((number) => issue_cite.plain_for('program', number)).join(' ')
}

function lines_of(causes: WaitCauses): ReadonlyArray<string> {
	const lines = CAUSES.filter((cause) => causes[cause].length > 0).map(
		(cause) => `${MARKS[cause]} ${cited(causes[cause])}`,
	)

	return causes.not_before_ms === undefined
		? lines
		: [...lines, `${DEADLINE_MARK}${String(causes.not_before_ms)}`]
}

// The numbers on the cause's line; a linkified `[#N](…/issues/N)` still reads as one `#N`.
function numbers_on(text: string, cause: WaitCause): ReadonlyArray<number> {
	const line = text.split('\n').find((candidate) => candidate.startsWith(MARKS[cause]))

	return [...(line ?? '').matchAll(ISSUE_PATTERN)].map((match) => Number(match[1]))
}

function parse(text: string): WaitCauses {
	const deadline = text.split('\n').find((line) => line.startsWith(DEADLINE_MARK))
	const not_before_ms = Number(deadline?.slice(DEADLINE_MARK.length))

	return {
		chain: numbers_on(text, 'chain'),
		gate: numbers_on(text, 'gate'),
		...(Number.isFinite(not_before_ms) && { not_before_ms }),
	}
}

// `chain`, `gate` or `chain+gate` — the held reason's last part — or `undefined` when neither applies.
function tag_of(causes: WaitCauses): string | undefined {
	const present = CAUSES.filter((cause) => causes[cause].length > 0)

	return present.length > 0 ? present.join(TAG_SEPARATOR) : undefined
}

function numbers_of(causes: WaitCauses): ReadonlyArray<number> {
	return [...causes.chain, ...causes.gate]
}

const backlog_wait_cause = { cause_of, classify, lines_of, numbers_of, parse, tag_of }

export type { WaitCauses }
export { backlog_wait_cause }
