import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { epic_bundle, type BacklogIssue } from './epic-bundle'
import { epic_bundle_cli } from './epic-bundle-cli'

const REPO = 'joshuafolkken/kit'
const FOLLOWS_TWO = 'follows #2'
const PARENT_LINE = 'parent: #900'
const CREATE_DECISION = { action: 'create_epic' as const, epics: [], candidates: [2], reason: '' }

interface IssueOptions {
	body?: string
	epic?: number
	is_epic?: boolean
	blocked_by?: ReadonlyArray<number>
}

const ISSUE_DEFAULTS = { repo: REPO, body: '', blocked_by: [], is_epic: false } as const

function issue(number: number, options: IssueOptions = {}): BacklogIssue {
	return { ...ISSUE_DEFAULTS, ...options, number }
}

describe('epic_bundle.is_strong_signal', () => {
	it('accepts a body that refers to the other issue', () => {
		expect(epic_bundle.is_strong_signal(issue(1, { body: FOLLOWS_TWO }), issue(2))).toBe(true)
	})

	it('accepts a reference written the other way round', () => {
		expect(epic_bundle.is_strong_signal(issue(1), issue(2, { body: 'blocks #1' }))).toBe(true)
	})

	it('accepts a recorded dependency', () => {
		expect(epic_bundle.is_strong_signal(issue(1, { blocked_by: [2] }), issue(2))).toBe(true)
	})

	it('accepts a dependency recorded on the other issue', () => {
		expect(epic_bundle.is_strong_signal(issue(1), issue(2, { blocked_by: [1] }))).toBe(true)
	})

	// "Related" expands without limit; a threshold is what keeps an unrelated issue out of the
	// bundle. A wording resemblance may inform the reader, but it may not be what decides.
	it('does not accept a similar title or wording on its own', () => {
		const first = issue(1, { body: 'Add josh epic:next to list runnable children' })
		const second = issue(2, { body: 'Add josh epic:audit to list contradictions' })

		expect(epic_bundle.is_strong_signal(first, second)).toBe(false)
	})

	it('does not match an issue against itself', () => {
		expect(epic_bundle.is_strong_signal(issue(1, { body: 'about #1' }), issue(1))).toBe(false)
	})

	it('reads a reference qualified with this repository', () => {
		const subject = issue(1, { body: `follows ${REPO}#2` })

		expect(epic_bundle.is_strong_signal(subject, issue(2))).toBe(true)
	})

	it('does not read another repository reference as a local one', () => {
		const subject = issue(1, { body: 'follows joshuafolkken/app-kit#2' })

		expect(epic_bundle.is_strong_signal(subject, issue(2))).toBe(false)
	})
})

describe('epic_bundle.decide_bundle — the four outcomes', () => {
	// An issue belongs to at most one epic, so a related issue already in one decides where this goes.
	it('adds to the epic that already tracks a related issue', () => {
		const decision = epic_bundle.decide_bundle(issue(1, { body: FOLLOWS_TWO }), [
			issue(2, { epic: 900 }),
		])

		expect(decision.action).toBe('add_to_epic')
		expect(decision.epic).toBe(900)
	})

	it('creates an epic when neither belongs to one', () => {
		const decision = epic_bundle.decide_bundle(issue(1, { body: FOLLOWS_TWO }), [issue(2)])

		expect(decision.action).toBe('create_epic')
		expect(decision.candidates).toEqual([2])
	})

	// Merging epics is not reversible in the way adding a child is.
	it('asks when the related issues are spread across different epics', () => {
		const decision = epic_bundle.decide_bundle(issue(1, { body: 'follows #2 and #3' }), [
			issue(2, { epic: 900 }),
			issue(3, { epic: 901 }),
		])

		expect(decision.action).toBe('ask')
		expect(decision.epics).toEqual([900, 901])
	})
})

describe('epic_bundle.decide_bundle — when it declines to act', () => {
	it('does nothing when no issue shares a reference or a dependency', () => {
		const decision = epic_bundle.decide_bundle(issue(1), [issue(2), issue(3)])

		expect(decision.action).toBe('none')
		expect(decision.candidates).toEqual([])
	})

	// Found by running the command on a real backlog: an epic is a container, not a sibling. Every
	// child names it as its parent, so without this every child found its own epic as a candidate.
	it('does not treat an epic as a candidate to bundle with', () => {
		const decision = epic_bundle.decide_bundle(issue(1, { body: PARENT_LINE }), [
			issue(900, { is_epic: true }),
		])

		expect(decision.action).toBe('none')
	})

	// Also found on the real backlog: an issue belongs to at most one epic, so one already tracked has
	// nothing to bundle — moving it between epics is not what this rule is for.
	it('does nothing when the issue itself already belongs to an epic', () => {
		const decision = epic_bundle.decide_bundle(issue(1, { body: FOLLOWS_TWO, epic: 900 }), [
			issue(2, { epic: 901 }),
		])

		expect(decision.action).toBe('none')
		expect(decision.epics).toStrictEqual([900])
	})
	it('does not create an epic on a hunch with no candidates', () => {
		const decision = epic_bundle.decide_bundle(issue(1, { body: 'unrelated prose' }), [issue(2)])

		expect(decision.action).toBe('none')
	})
})

describe('epic_bundle.decide_bundle — what the reason has to say', () => {
	// The number is the actionable half: the prerequisite procedure inserts into *that* epic rather
	// than creating a second one, and a reason that only says "an epic" leaves the caller to go and
	// find it (joshuafolkken/kit#943).
	it('names the epic that already tracks it', () => {
		const decision = epic_bundle.decide_bundle(issue(1, { body: FOLLOWS_TWO, epic: 900 }), [
			issue(2, { epic: 901 }),
		])

		expect(decision.reason).toBe(epic_bundle.already_tracked_reason(900))
		expect(decision.reason).toContain('#900')
	})

	it('says why it decided what it did', () => {
		expect(epic_bundle.decide_bundle(issue(1), [issue(2)]).reason).toBe(
			epic_bundle.NO_SIGNAL_REASON,
		)
	})
})

// Bundling without the order records the batch and loses the reason it is a batch.
describe('epic_bundle.bundle_dependency_links', () => {
	it('carries a declared dependency between the bundled issues', () => {
		const subject = issue(1, { blocked_by: [2] })
		const links = epic_bundle.bundle_dependency_links(subject, [issue(2)])

		expect(links).toEqual([{ blocker: 2, blocked: 1 }])
	})

	it('ignores a dependency on something outside the bundle', () => {
		const subject = issue(1, { blocked_by: [999] })

		expect(epic_bundle.bundle_dependency_links(subject, [issue(2)])).toEqual([])
	})

	// An order nobody stated is not invented here.
	it('records nothing when no dependency was declared', () => {
		expect(epic_bundle.bundle_dependency_links(issue(1), [issue(2)])).toEqual([])
	})
})

describe('epic_bundle.bundle_children', () => {
	it('tracks the subject alongside its candidates', () => {
		expect(epic_bundle.bundle_children(issue(3), [issue(1), issue(2)])).toEqual([1, 2, 3])
	})
})

// Asked about an epic, the one-sided check found every one of its children through their own
// `parent: #N` line and proposed bundling a container with its contents.
describe('epic_bundle.is_strong_signal — an epic is never a candidate', () => {
	it('refuses a candidate that is an epic', () => {
		const subject = issue(1, { body: PARENT_LINE })

		expect(epic_bundle.is_strong_signal(subject, issue(900, { is_epic: true }))).toBe(false)
	})

	it('refuses every candidate when the subject itself is an epic', () => {
		const subject = issue(900, { is_epic: true })

		expect(epic_bundle.is_strong_signal(subject, issue(1, { body: PARENT_LINE }))).toBe(false)
	})
})

describe('epic_bundle_cli.format_order', () => {
	// Bundling without the order records the batch and loses the reason it is a batch.
	it('names the children a bundle would track', () => {
		const subject = issue(3, { body: FOLLOWS_TWO })
		const decision = { action: 'create_epic' as const, epics: [], candidates: [2], reason: '' }

		expect(epic_bundle_cli.format_order(decision, subject, [issue(2)]).join('\n')).toContain(
			'#2, #3',
		)
	})

	it('names a declared order', () => {
		const subject = issue(3, { blocked_by: [2] })
		const lines = epic_bundle_cli.format_order(CREATE_DECISION, subject, [issue(2)]).join('\n')

		expect(lines).toContain('#2 -> #3')
	})

	// An order nobody declared is not invented here, and the report says so rather than staying quiet.
	it('says so when no order was declared', () => {
		const subject = issue(3, { body: FOLLOWS_TWO })

		expect(epic_bundle_cli.format_order(CREATE_DECISION, subject, [issue(2)]).join('\n')).toContain(
			'none declared',
		)
	})

	it('says nothing about order when there is nothing to bundle', () => {
		const decision = { action: 'none' as const, epics: [], candidates: [], reason: '' }

		expect(epic_bundle_cli.format_order(decision, issue(1), [])).toEqual([])
	})
})

describe('epic_bundle_cli.build_epic_index', () => {
	it('maps each tracked child to the epic tracking it', () => {
		const index = epic_bundle_cli.build_epic_index([
			{ number: 900, body: '- [ ] #1\n- [ ] #2' },
			{ number: 901, body: '- [ ] #3' },
		])

		expect(index.get(1)).toBe(900)
		expect(index.get(3)).toBe(901)
	})

	it('leaves an issue no epic tracks unmapped', () => {
		const index = epic_bundle_cli.build_epic_index([{ number: 900, body: '- [ ] #1' }])

		expect(index.get(2)).toBeUndefined()
	})
})

describe('josh epic:bundle registration', () => {
	it('is registered as a command', () => {
		const entry = COMMAND_MAP['epic:bundle']

		expect(entry?.script).toBe('scripts/epic/epic-bundle-cli.ts')
	})

	it('is reachable through the eb alias', () => {
		const { eb } = ALIASES

		expect(eb).toBe('epic:bundle')
	})
})
