import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#969: the delegation policy is an enumeration in code and prose in two documents.
// A document that lists a step the command does not, or omits one it does, sends a reader to apply a
// rule the tool will not — and the direction that matters is a document promising `delegate` for
// something the command keeps.

const CANONICAL = 'prompts/collaboration-workflow/delegation.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const BOTH: ReadonlyArray<string> = [CANONICAL, SKILL, COMMAND_DOC]
const COMMAND = 'pnpm josh delegate'

describe.each(BOTH)('%s — routes the decision to the command', (document_path) => {
	const content = read_repo_file(document_path)

	it('names the command', () => {
		expect(content).toContain(COMMAND)
	})

	// The direction of the default is the safety argument; a document that omits it reads as though
	// an unlisted step were a judgement call.
	it('states that anything unlisted is kept', () => {
		expect(read_unwrapped(document_path)).toMatch(
			/not on the list is `keep`|列挙に無い工程はすべて `keep`/u,
		)
	})
})

// Both halves of the enumeration have to appear — and the document must name **exactly** what the
// command delegates. Asserting only that the known names are present lets a document grow an extra
// row: a reader would then be promised `delegate` for a step the command keeps, which is the one
// direction of drift that costs correctness rather than money.
const TABLE_HEADERS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
	[CANONICAL, ['工程', '内容', '誤りが捕まる経路']],
	[COMMAND_DOC, ['Step', 'Delegatable because']],
]

// The rejected half needs the same treatment. Left unguarded it drifted immediately: the command
// listed seven rejected steps while the documents recorded three, so four of them read as "never
// considered" — which invites exactly the proposal the list exists to answer.
const REJECTED_TABLE_HEADERS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
	[CANONICAL, ['工程', '却下理由']],
	[COMMAND_DOC, ['Step', 'Kept because']],
]

const FIRST_CODE_SPAN = /^\|\s*`([^`]+)`/u

function row_cells(line: string): Array<string> {
	return line
		.split('|')
		.slice(1, -1)
		.map((cell) => cell.trim())
}

// Matched on cell contents, never on the line: prettier pads the columns, and `docs/` carries more
// than one table whose first column is `Step`.
function table_start(lines: ReadonlyArray<string>, header: ReadonlyArray<string>): number {
	return lines.findIndex(
		(line) =>
			line.startsWith('|') &&
			row_cells(line).length === header.length &&
			row_cells(line).every((cell, index) => cell === header[index]),
	)
}

// The first code span of each row under the delegatable table, up to the blank line that ends it.
function tabled_steps(document_path: string, header: ReadonlyArray<string>): Array<string> {
	const lines = read_repo_file(document_path).split('\n')
	const start = table_start(lines, header)

	if (start === -1) return []

	// `start + 2` skips the header and the `| --- |` separator; the table ends at the first line that
	// is not a row.
	const rows = lines.slice(start + 2)
	const end = rows.findIndex((line) => !line.startsWith('|'))

	return rows
		.slice(0, end === -1 ? rows.length : end)
		.map((line) => FIRST_CODE_SPAN.exec(line)?.[1])
		.filter((name): name is string => name !== undefined)
		.toSorted((left, right) => left.localeCompare(right))
}

function rejected_policy_steps(): Array<string> {
	return delegation_policy.REJECTED_STEPS.map((step) => step.name).toSorted((left, right) =>
		left.localeCompare(right),
	)
}

function policy_steps(): Array<string> {
	return delegation_policy.DELEGATABLE_STEPS.map((step) => step.name).toSorted((left, right) =>
		left.localeCompare(right),
	)
}

describe.each(TABLE_HEADERS)(
	'%s — its table is the policy, not a subset',
	(document_path, header) => {
		it('has a delegatable table at all', () => {
			expect(tabled_steps(document_path, header).length).toBeGreaterThan(0)
		})

		it('lists exactly what the command delegates', () => {
			expect(tabled_steps(document_path, header)).toStrictEqual(policy_steps())
		})
	},
)

describe.each(REJECTED_TABLE_HEADERS)(
	'%s — records every step that was considered and kept',
	(document_path, header) => {
		it('has a rejected table at all', () => {
			expect(tabled_steps(document_path, header).length).toBeGreaterThan(0)
		})

		// Identifiers, not prose labels: a reader who takes a label from this table and runs the
		// command must get `kept deliberately`, which is the distinction `reason_for` exists to make.
		it('names them by the identifier the command accepts', () => {
			expect(tabled_steps(document_path, header)).toStrictEqual(rejected_policy_steps())
		})
	},
)

describe('a rejected step is told apart from an unlisted one', () => {
	it.each(delegation_policy.REJECTED_STEPS.map((step) => step.name))(
		'%s answers kept deliberately',
		(name) => {
			expect(delegation_policy.verdict_for(name)).toBe(delegation_policy.KEEP_VERDICT)
			expect(delegation_policy.reason_for(name)).toContain('kept deliberately')
		},
	)

	it('the canonical says why a candidate without a verifier is rejected', () => {
		expect(read_unwrapped(CANONICAL)).toContain('検証経路が無い')
	})
})

// The condition that decides membership. A document that dropped it would leave the list looking
// arbitrary, and the next addition would be argued rather than tested.
describe.each(BOTH)('%s — states the condition a step must meet', (document_path) => {
	it('says a wrong result has to be caught, not merely unlikely', () => {
		expect(read_unwrapped(document_path)).toMatch(/caught|捕まる/u)
	})
})

// joshuafolkken/kit#984 reuses this mechanism with a different unit. Said in only one place, the
// next implementer builds a second one.
describe.each(BOTH)('%s — separates the mechanism from the unit', (document_path) => {
	it('says the two are not the same thing', () => {
		expect(read_unwrapped(document_path)).toMatch(/mechanism is not the unit|機構と単位を分ける/u)
	})

	it('names the other unit that shares the mechanism', () => {
		expect(read_repo_file(document_path)).toContain('984')
	})
})

// joshuafolkken/kit#1149: the unit widened from "an epic's child" to "one child of a batch", so a
// `queue`'s issues run isolated too. A document that still describes the row as an epic-only unit
// sends a `queue` to accumulate every issue's history in one context — which is what it did before
// the widening, and reads as correct because the row it consulted said so.
const QUEUE_SKILL = '.claude/skills/workflow-commands/queue.md'
const EPIC_CHILD = 'epic-child'
const DELEGATION_COMMAND = `pnpm josh delegate ${EPIC_CHILD}`
const STATE_READ = 'pnpm josh issue:state'

const QUEUE_UNIT_MARKERS: ReadonlyArray<[string, string]> = [
	[CANONICAL, '`queue-child` のような 2 行目を足さない'],
	[SKILL, "an epic's child under `epicrun` and one issue of a `queue` alike"],
	[COMMAND_DOC, 'One row covers both batch entry points'],
]

describe.each(QUEUE_UNIT_MARKERS)(
	'%s — the unit covers a queue as well as an epic',
	(document_path, marker) => {
		it('says one row covers both batch entry points', () => {
			expect(read_unwrapped(document_path)).toContain(marker)
		})
	},
)

describe('the widened unit is one row, not a second', () => {
	// The prose above is only true while the command agrees with it: a `queue` reading `--list` to
	// learn what it is agreeing to must find itself in the row it was told to ask about.
	it('is what the command prints for the one row', () => {
		expect(delegation_policy.find_step(EPIC_CHILD)?.does).toContain('`queue`')
	})

	it('adds no queue-only row for the documents to describe', () => {
		expect(delegation_policy.find_step('queue-child')).toBeUndefined()
	})
})

describe(`${QUEUE_SKILL} — each issue runs in the delegated unit`, () => {
	const content = read_repo_file(QUEUE_SKILL)
	const unwrapped = read_unwrapped(QUEUE_SKILL)

	// A heading, not merely the words: step 2b points at it by name, and a paragraph buried in the
	// key rules is one a run scanning the headings never reaches.
	it('has the section as a heading of its own', () => {
		expect(content).toMatch(/^#{2,4} Each issue runs in a delegated unit$/mu)
	})

	it('routes the decision to the command rather than to judgement', () => {
		expect(unwrapped).toContain(DELEGATION_COMMAND)
	})

	// The verifier is the whole reason the unit may be delegated. A queue that advanced on the
	// returned summary would start the next issue against an issue that never merged.
	it('says the parent confirms the issue from GitHub, not from the summary', () => {
		expect(unwrapped).toContain(STATE_READ)
		expect(unwrapped).toContain('The parent reads GitHub, never the summary')
	})

	// Pointing rather than restating is the single-source half: a second copy of the mechanism drifts
	// from the first edit onward, and `CLAUDE.md` prohibits it by name.
	it('points at the one definition instead of restating it', () => {
		expect(unwrapped).toContain(CANONICAL)
	})
})

// What the parent still owes once the work is out of its context: the reads that decide whether an
// issue actually finished, and the two rules a unit briefed only with "run `fullrun #<N>`" would
// otherwise break. Each was written after a failure, and each is silent when omitted.
describe(`${QUEUE_SKILL} — what the parent keeps when the issue is delegated`, () => {
	const unwrapped = read_unwrapped(QUEUE_SKILL)

	it.each([
		'`--repo` is not optional for a cross-repository issue',
		'read the `human_review:` line rather than eye-matching the `labels:` one',
		'a non-zero exit is not `OPEN`',
		// One stop, one Telegram: the unit already notified the pause it stopped for.
		'Do not send a second `confirmation` Telegram',
	])('carries %j', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	// Step 2a only covers issues that have a successor, so the last merge reaches this checkout only
	// if the loop's tail says so.
	it('pulls the final delegated merge back after the last issue', () => {
		expect(unwrapped).toContain('Run `pnpm josh ms` once more here')
	})

	// Delegation moves the merge out of the checkout the loop implements in, so the step that pulls it
	// back stops being defensive. Left unsaid, the next issue is implemented against a stale default
	// branch.
	it('says the per-issue `pnpm josh ms` is what brings the merge back', () => {
		expect(unwrapped).toContain('the checkout the queue implements in')
	})

	// The two rules a unit briefed only with "run `fullrun #<N>`" would otherwise break: it would
	// follow `fullrun.md` and bump dependencies into every PR after the first, and the label it
	// applied would outlive it on a failure — which makes `epic:next` answer `wait` for the whole
	// repository.
	it.each(['`josh latest` is not run', 'Remove the stale `in-progress` here'])(
		'keeps the parent-side rule %j',
		(marker) => {
			expect(unwrapped).toContain(marker)
		},
	)
})
