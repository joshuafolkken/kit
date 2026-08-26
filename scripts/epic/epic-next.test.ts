import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import type { EpicSnapshot } from './epic-fetch'
import type { EpicChild } from './epic-graph'
import { epic_next } from './epic-next'

const REPO = 'joshuafolkken/kit'
const DEPENDENCIES_BODY = 'Dependencies\n\n#1 -> #2'
const UNORDERED_BODY = 'None — the children are independent; any execution order works.'
const CROSS_REPO_REFERENCE = 'joshuafolkken/kit#858'

function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by }
}

function snapshot(children: ReadonlyArray<EpicChild>, body?: string): EpicSnapshot {
	return {
		body,
		children,
		child_numbers: children.map((entry) => entry.number),
		unreadable: [],
		skipped: [],
		has_external_children: false,
	}
}

describe('epic_next.parse_epic_number', () => {
	it('accepts a bare number', () => {
		expect(epic_next.parse_epic_number('858')).toBe(858)
	})

	it('accepts the number copied out of an issue reference', () => {
		expect(epic_next.parse_epic_number('#858')).toBe(858)
	})

	it('refuses anything that is not a positive issue number', () => {
		for (const raw of ['', 'abc', '0', '-3']) {
			expect(epic_next.parse_epic_number(raw)).toBeUndefined()
		}
	})

	// Read as a bare `858` it would answer about *this* repository's issue 858, which is a different
	// issue entirely. Resolving an epic in another repository is joshuafolkken/kit#864.
	it('refuses a cross-repository reference rather than reading the number out of it', () => {
		expect(epic_next.parse_epic_number(CROSS_REPO_REFERENCE)).toBeUndefined()
	})

	it('says why a cross-repository reference was refused', () => {
		const { usage } = epic_next.parse_options([CROSS_REPO_REFERENCE])

		expect(usage).toBe(epic_next.CROSS_REPO_USAGE)
		expect(usage).toContain('#864')
	})
})

describe('epic_next.parse_options', () => {
	it('reads the epic number', () => {
		expect(epic_next.parse_options(['858']).epic_number).toBe(858)
	})

	it('reads the repository to narrow to', () => {
		expect(epic_next.parse_options(['858', '--repo', REPO]).repo).toBe(REPO)
	})
})

describe('epic_next.parse_options — refusals', () => {
	it('refuses a --repo with nothing after it', () => {
		expect(epic_next.parse_options(['858', '--repo']).usage).toContain('Usage:')
	})

	it('refuses a missing epic number', () => {
		expect(epic_next.parse_options([]).usage).toContain('Usage:')
	})
})

// The documented `epicrun` loop branches on a number, `wait`, `stop` or `complete`. `run` would be a
// token it has no branch for — and it only arises when *another* repository has the work.
describe('epic_next.repo_verdict', () => {
	it('reports another repository having work as something to wait on', () => {
		expect(epic_next.repo_verdict('run')).toBe('wait')
	})

	it('passes the other verdicts through unchanged', () => {
		for (const verdict of ['wait', 'stop', 'complete'] as const) {
			expect(epic_next.repo_verdict(verdict)).toBe(verdict)
		}
	})
})

describe('epic_next.decide', () => {
	it('offers the unblocked children', () => {
		const result = epic_next.decide(snapshot([child(1), child(2, [1])]))

		expect(result.verdict).toBe('run')
		expect(result.candidates[0]?.children.map((entry) => entry.number)).toEqual([1])
	})

	it('reports completion when every child is closed', () => {
		const closed: EpicChild = { ...child(1), state: 'CLOSED' }

		expect(epic_next.decide(snapshot([closed])).verdict).toBe('complete')
	})

	// The body declares an order the relations do not record — gh older than 2.94.0 produces exactly
	// this, and following either silently would implement in an order nobody agreed to.
	it('stops on a disagreement between the body and the relations', () => {
		const result = epic_next.decide(snapshot([child(1), child(2)], DEPENDENCIES_BODY))

		expect(result.verdict).toBe('error')
		expect(result.anomalies[0]?.kind).toBe('declaration_mismatch')
	})

	it('accepts a body whose declaration the relations record', () => {
		const result = epic_next.decide(snapshot([child(1), child(2, [1])], DEPENDENCIES_BODY))

		expect(result.verdict).toBe('run')
	})

	// The body says the children are independent while a relation says otherwise — the other half of
	// the same disagreement, and the reason the unordered sentence counts as a declaration.
	it('stops when the body declares independence but a relation was recorded', () => {
		const result = epic_next.decide(snapshot([child(1), child(2, [1])], UNORDERED_BODY))

		expect(result.verdict).toBe('error')
	})
})

describe('epic_next.decide — the graph anomalies', () => {
	it('stops on a circular dependency', () => {
		const result = epic_next.decide(snapshot([child(1, [2]), child(2, [1])]))

		expect(result.verdict).toBe('error')
		expect(result.anomalies[0]?.kind).toBe('cycle')
	})

	it('reads the declaration through the shared epic parser', () => {
		const body = 'Dependencies\n\n#1 -> #2 -> #3'

		expect(git_epic_parse.parse_dependency_links(body)).toEqual([
			{ blocker: 1, blocked: 2 },
			{ blocker: 2, blocked: 3 },
		])
	})
})

// Dropping an unreadable child is wrong in both directions: an epic whose children all failed to
// read looks complete, and one missing child leaves whatever it blocks looking unblocked.
describe('epic_next.decide — children that could not be read', () => {
	it('refuses rather than reporting a fully open epic as complete', () => {
		const result = epic_next.decide({ ...snapshot([]), child_numbers: [1, 2], unreadable: [1, 2] })

		expect(result.verdict).toBe('error')
	})

	it('refuses rather than offering a child whose blocker went missing', () => {
		const partial = { ...snapshot([child(2, [1])]), child_numbers: [1, 2], unreadable: [1] }
		const result = epic_next.decide(partial)

		expect(result.verdict).toBe('error')
		expect(result.candidates).toEqual([])
	})

	it('names the children it could not read', () => {
		const result = epic_next.decide({ ...snapshot([]), child_numbers: [7], unreadable: [7] })

		expect(result.anomalies[0]?.message).toContain('#7')
	})

	it('refuses rather than silently truncating a very large epic', () => {
		const result = epic_next.decide({ ...snapshot([child(1)]), skipped: [2] })

		expect(result.verdict).toBe('error')
	})
})

describe('epic_next.is_order_declared', () => {
	// The unanchored existence check and the line-anchored link parser used to disagree: a body whose
	// arrows are all prose counted as a declaration with zero links, so every correct relation was
	// reported as undeclared.
	it('does not count a body whose arrows are only prose', () => {
		expect(epic_next.is_order_declared('推奨実行順: #1 -> #2', [])).toBe(false)
	})

	it('counts a body with a declared chain', () => {
		expect(epic_next.is_order_declared(DEPENDENCIES_BODY, [{}])).toBe(true)
	})

	it('counts the sentence declaring the children independent', () => {
		expect(epic_next.is_order_declared(UNORDERED_BODY, [])).toBe(true)
	})
})

describe('josh epic:next registration', () => {
	it('is registered as a command', () => {
		const entry = COMMAND_MAP['epic:next']

		expect(entry?.script).toBe('scripts/epic/epic-next.ts')
	})

	it('is reachable through the en alias', () => {
		const { en } = ALIASES

		expect(en).toBe('epic:next')
	})
})
