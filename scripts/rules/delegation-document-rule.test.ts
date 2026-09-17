import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { read_repo_file, read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#969: the delegation policy is an enumeration in code and prose in the documents.
// A document that lists a step the command does not, or omits one it does, sends a reader to apply a
// rule the tool will not — and the direction that matters is a document promising `delegate` for
// something the command keeps.
//
// joshuafolkken/kit#1959: the rule's history and measurement moved out of the always-read skill —
// joshuafolkken/kit#1925 trims SKILL.md and queue.md down to rules, and deletes the delegation.md
// pointer stub. So this suite no longer pins issue-number stories, the measured cost, or the pointer
// body; the rule's presence is held by the code-versus-policy table equality, the delegation_policy
// verdicts, the rule sentences the command reference keeps, and the §2b anchor in
// `document-markers.test.ts`.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const COMMAND_DOC = 'docs/josh-commands.md'
// The skill is the rule; `docs/` is the command's own reference and carries the enumeration a person
// reads. Both must route the decision to the command rather than to judgement.
const RULE_DOCS: ReadonlyArray<string> = [SKILL, COMMAND_DOC]
const COMMAND = 'pnpm josh delegate'
// The verdict the command gives a step that was weighed and kept, and the words the prose uses for
// it. One literal, so a rename in `delegation-policy.ts` fails the document assertion too.
const KEPT_DELIBERATELY = 'kept deliberately'
// The case title shared by the marker-presence suites below.
const CARRIES_CASE = 'carries %j'

describe.each(RULE_DOCS)('%s — routes the decision to the command', (document_path) => {
	const content = read_repo_file(document_path)

	it('names the command', () => {
		expect(content).toContain(COMMAND)
	})

	// The direction of the default is the safety argument; a document that omits it reads as though
	// an unlisted step were a judgement call.
	it('states that anything unlisted is kept', () => {
		expect(read_unwrapped(document_path)).toContain('not on the list is `keep`')
	})
})

// Both halves of the enumeration have to appear — and the document must name **exactly** what the
// command delegates. Asserting only that the known names are present lets a document grow an extra
// row: a reader would then be promised `delegate` for a step the command keeps, which is the one
// direction of drift that costs correctness rather than money.
const TABLE_HEADERS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
	[COMMAND_DOC, ['Step', 'Delegatable because']],
]

// The rejected half needs the same treatment. Left unguarded it drifted immediately: the command
// listed seven rejected steps while the documents recorded three, so four of them read as "never
// considered" — which invites exactly the proposal the list exists to answer.
const REJECTED_TABLE_HEADERS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
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
		// Identifiers, not prose labels: a reader who takes a label from this table and runs the
		// command must get `kept deliberately`, which is the distinction `reason_for` exists to make.
		// Asserted as equality rather than presence, so a table that is missing entirely fails here too.
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
			expect(delegation_policy.reason_for(name)).toContain(KEPT_DELIBERATELY)
		},
	)
})

// The condition that decides membership. A document that dropped it would leave the list looking
// arbitrary, and the next addition would be argued rather than tested.
describe.each(RULE_DOCS)('%s — states the condition a step must meet', (document_path) => {
	// The distinctive phrase, not the bare word: "caught" appears three times in `docs/` in unrelated
	// prose, so a document that dropped the condition entirely would still have passed.
	it('says a wrong result has to be caught, not merely unlikely', () => {
		expect(read_unwrapped(document_path)).toContain('how a wrong result is caught')
	})
})

// The mechanism is one thing and the unit another; a document that fused them would have the next
// implementer build a second mechanism. A rule, so it stays pinned.
describe.each(RULE_DOCS)('%s — separates the mechanism from the unit', (document_path) => {
	it('says the two are not the same thing', () => {
		expect(read_unwrapped(document_path)).toContain('mechanism is not the unit')
	})
})

// joshuafolkken/kit#1149: the unit widened from "an epic's child" to "one child of a batch", so a
// `backlogrun`'s named issues run isolated too (joshuafolkken/kit#1984 folded in the old `queue`). A
// document that still describes the row as an epic-only unit sends a batch to accumulate every issue's
// history in one context — which is what it did before the widening, and reads as correct because the
// row it consulted said so.
const EPIC_CHILD = 'epic-child'

const BATCH_UNIT_MARKERS: ReadonlyArray<[string, string]> = [
	[SKILL, "an epic's child and a named issue of a `backlogrun` alike"],
	[COMMAND_DOC, 'One row covers both batch entry points'],
]

describe.each(BATCH_UNIT_MARKERS)(
	'%s — the unit covers a backlogrun named issue as well as an epic',
	(document_path, marker) => {
		it('says one row covers both batch entry points', () => {
			expect(read_unwrapped(document_path)).toContain(marker)
		})
	},
)

describe('the widened unit is one row, not a second', () => {
	// The prose above is only true while the command agrees with it: a `backlogrun` reading `--list` to
	// learn what it is agreeing to must find itself in the row it was told to ask about.
	it('is what the command prints for the one row', () => {
		expect(delegation_policy.find_step(EPIC_CHILD)?.does).toContain('`backlogrun`')
	})

	it('adds no batch-only row for the documents to describe', () => {
		expect(delegation_policy.find_step('backlogrun-child')).toBeUndefined()
	})
})

// The delegated-unit procedure a batch child runs is `backlogrun.md`'s single source, and
// `backlogrun.md` → "Named issues run first, in order" points at it rather than restating it
// (joshuafolkken/kit#1984 removed queue.md, which used to carry a second copy). So the markers that
// were pinned against queue.md are not re-pinned against backlogrun.md — restating them there would be
// the clone this rule exists to prevent.

// The pre-implementation reading is delegated too, and its threshold is a number both rule documents
// have to carry. A document that stated the line without the number leaves the count to judgement,
// which is the one thing this whole rule refuses — and one that omitted the return shape would have a
// unit hand back the file text, which puts the cost back where it was.
const THRESHOLD_SENTENCE = `the threshold is ${String(delegation_policy.INVESTIGATION_FILE_THRESHOLD)} files, and it is a count, not a forecast`
// What a delegation does to the count.
const RESET_SENTENCE = 'a delegation resets the counter rather than spending it'
const READ_GUARD_COMMAND = 'josh investigation:guard'

describe.each(RULE_DOCS)('%s — carries the pre-implementation reading rule', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	// Asserted as one sentence so the numeral is pinned to the constant rather than to a bare `3`,
	// which occurs throughout both documents in unrelated prose.
	it('gives the threshold as the number the command prints', () => {
		expect(unwrapped.toLowerCase()).toContain(THRESHOLD_SENTENCE)
	})

	it.each(['never the file text', 'probe script', 'it is not `survey`, and it is not `diagnosis`'])(
		CARRIES_CASE,
		(marker) => {
			expect(unwrapped.toLowerCase()).toContain(marker.toLowerCase())
		},
	)

	// The verdict command prints the verifier, so a document that named it as the source of the count
	// sends an agent to a call that answers without one — and back to judging the count.
	it('sends the reader to the listing for the count, not to the verdict command', () => {
		expect(unwrapped).toContain(`${COMMAND} --list`)
		expect(unwrapped).not.toContain(`${COMMAND} investigation prints it`)
	})

	// A document that states the count without saying what a delegation does to it leaves the
	// threshold as a one-shot judgement. The command has to be named too: the counting moved out of
	// the agent's head, and a document that omits where it went sends a reader back to counting by
	// hand.
	it('says a delegation resets the counter, and names what counts', () => {
		expect(unwrapped.toLowerCase()).toContain(RESET_SENTENCE)
		expect(unwrapped).toContain(READ_GUARD_COMMAND)
	})
})
