import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_add } from './epic-add'
import type { BacklogIssue, BundleDecision } from './epic-bundle'
import { epic_bundle_apply, type ApplyInput } from './epic-bundle-apply'
import { epic_reconcile } from './epic-reconcile'
import { epic_run } from './epic-run'

vi.mock('./epic-add', () => ({ epic_add: { add_children: vi.fn() } }))
vi.mock('./epic-run', () => ({ epic_run: { create_epic_number: vi.fn() } }))
vi.mock('./epic-reconcile', () => ({ epic_reconcile: { reconcile_epic: vi.fn() } }))

// The writes `--apply` makes go through `epic --add`'s and `epic`'s own writers, so what this file
// fixes is which writer each verdict reaches and that `ask` / `none` reach none of them.

const REPO = 'joshuafolkken/kit'
const EPIC_NUMBER = 893
const NEW_EPIC_NUMBER = 900
const SUBJECT_NUMBER = 894
const CANDIDATE_NUMBER = 890
const OTHER_CANDIDATE_NUMBER = 891
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const REASON = 'They reference each other.'

const mocked_add = vi.mocked(epic_add.add_children)
const mocked_create = vi.mocked(epic_run.create_epic_number)
const mocked_reconcile = vi.mocked(epic_reconcile.reconcile_epic)

function issue(number: number, overrides: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], ...overrides }
}

function decision(overrides: Partial<BundleDecision>): BundleDecision {
	return { action: 'none', epics: [], candidates: [CANDIDATE_NUMBER], reason: REASON, ...overrides }
}

function input(
	bundle: Partial<BundleDecision>,
	members: ReadonlyArray<BacklogIssue> = [issue(CANDIDATE_NUMBER)],
): ApplyInput {
	return {
		decision: decision(bundle),
		subject: issue(SUBJECT_NUMBER, { title: 'Bundle the epic writers' }),
		members,
		is_membership_established: true,
	}
}

const BLOCKED_MEMBER = issue(CANDIDATE_NUMBER, {
	blocked_by: [{ number: SUBJECT_NUMBER, repo: REPO }],
})

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	mocked_add.mockResolvedValue(SUCCESS_EXIT_CODE)
	mocked_create.mockResolvedValue(NEW_EPIC_NUMBER)
	mocked_reconcile.mockResolvedValue(SUCCESS_EXIT_CODE)
})

describe('epic_bundle_apply.apply_decision — add_to_epic', () => {
	it('adds the bundle to the named epic through epic --add', async () => {
		const result = await epic_bundle_apply.apply_decision(
			input({ action: 'add_to_epic', epic: EPIC_NUMBER, epics: [EPIC_NUMBER] }),
		)

		expect(result).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_add).toHaveBeenCalledWith({
			epic_number: EPIC_NUMBER,
			children: [CANDIDATE_NUMBER, SUBJECT_NUMBER],
		})
		expect(mocked_reconcile).not.toHaveBeenCalled()
	})

	it('reconciles the epic only when the members record an order', async () => {
		await epic_bundle_apply.apply_decision(
			input({ action: 'add_to_epic', epic: EPIC_NUMBER, epics: [EPIC_NUMBER] }, [BLOCKED_MEMBER]),
		)

		expect(mocked_reconcile).toHaveBeenCalledWith(EPIC_NUMBER)
	})

	it('stops with the add failure and does not reconcile', async () => {
		mocked_add.mockResolvedValue(FAILURE_EXIT_CODE)

		const result = await epic_bundle_apply.apply_decision(
			input({ action: 'add_to_epic', epic: EPIC_NUMBER, epics: [EPIC_NUMBER] }, [BLOCKED_MEMBER]),
		)

		expect(result).toBe(FAILURE_EXIT_CODE)
		expect(mocked_reconcile).not.toHaveBeenCalled()
	})
})

describe('epic_bundle_apply.apply_decision — add_to_epic beside a parent epic', () => {
	it('leaves a candidate tracked by another epic where it is', async () => {
		const PARENT_EPIC = 880
		const PARENT_MEMBER = 870

		await epic_bundle_apply.apply_decision(
			input({ action: 'add_to_epic', epic: EPIC_NUMBER, epics: [EPIC_NUMBER] }, [
				issue(PARENT_MEMBER, { epic: PARENT_EPIC }),
				issue(CANDIDATE_NUMBER, { epic: EPIC_NUMBER }),
			]),
		)

		expect(mocked_add).toHaveBeenCalledWith({
			epic_number: EPIC_NUMBER,
			children: [CANDIDATE_NUMBER, SUBJECT_NUMBER],
		})
	})
})

describe('epic_bundle_apply.apply_decision — create_epic', () => {
	it('creates an unordered epic titled after the subject, with the reason as rationale', async () => {
		const result = await epic_bundle_apply.apply_decision(input({ action: 'create_epic' }))

		expect(result).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_create).toHaveBeenCalledWith({
			title: 'Epic: Bundle the epic writers',
			children: [CANDIDATE_NUMBER, SUBJECT_NUMBER],
			rationale: REASON,
			is_ordered: false,
		})
		expect(mocked_add).not.toHaveBeenCalled()
	})

	it('reconciles the new epic when the members record an order', async () => {
		await epic_bundle_apply.apply_decision(input({ action: 'create_epic' }, [BLOCKED_MEMBER]))

		expect(mocked_reconcile).toHaveBeenCalledWith(NEW_EPIC_NUMBER)
	})

	it('fails rather than dropping the order when the new epic number is unreadable', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		mocked_create.mockResolvedValue(undefined)

		const result = await epic_bundle_apply.apply_decision(
			input({ action: 'create_epic' }, [BLOCKED_MEMBER]),
		)

		expect(result).toBe(FAILURE_EXIT_CODE)
		expect(error).toHaveBeenCalledWith(epic_bundle_apply.UNREAD_EPIC_LINE)
		expect(mocked_reconcile).not.toHaveBeenCalled()
	})

	it('falls back to the subject number when the subject has no title', () => {
		expect(epic_bundle_apply.title_of(issue(SUBJECT_NUMBER))).toBe('Epic: bundle with #894')
	})
})

describe('epic_bundle_apply.apply_decision — ask', () => {
	const OTHER_EPIC = 880
	const SPREAD_MEMBERS = [
		issue(CANDIDATE_NUMBER, { epic: EPIC_NUMBER }),
		issue(OTHER_CANDIDATE_NUMBER, { epic: OTHER_EPIC }),
	]

	it('places the subject in the recommended epic and records the choice', async () => {
		const result = await epic_bundle_apply.apply_decision(
			input(
				{ action: 'ask', epics: [OTHER_EPIC, EPIC_NUMBER], recommended: EPIC_NUMBER },
				SPREAD_MEMBERS,
			),
		)

		const added = mocked_add.mock.calls[0]?.[0]

		expect(result).toBe(SUCCESS_EXIT_CODE)
		expect(added).toMatchObject({
			epic_number: EPIC_NUMBER,
			children: [CANDIDATE_NUMBER, SUBJECT_NUMBER],
		})
		expect(added?.decision).toMatch(
			/^Auto-decided \(\d{4}-\d{2}-\d{2}, `epic:bundle --apply`\): placed #894 in #893 over #880/u,
		)
	})

	it('writes nothing when no epic is recommended', async () => {
		const result = await epic_bundle_apply.apply_decision(
			input({ action: 'ask', epics: [OTHER_EPIC, EPIC_NUMBER] }, SPREAD_MEMBERS),
		)

		expect(result).toBe(SUCCESS_EXIT_CODE)
		expect(console.info).toHaveBeenCalledWith(epic_bundle_apply.UNAPPLIED_LINES.ask)
		expect(epic_bundle_apply.UNAPPLIED_LINES.ask).toContain('declare a cycle')
		expect(mocked_add).not.toHaveBeenCalled()
	})
})

describe('epic_bundle_apply.apply_decision — nothing written', () => {
	it.each(['ask', 'none'] as const)('writes nothing for %s and prints why', async (action) => {
		const result = await epic_bundle_apply.apply_decision(input({ action }))

		expect(result).toBe(SUCCESS_EXIT_CODE)
		expect(console.info).toHaveBeenCalledWith(epic_bundle_apply.UNAPPLIED_LINES[action])
		expect(mocked_add).not.toHaveBeenCalled()
		expect(mocked_create).not.toHaveBeenCalled()
	})

	it('writes nothing when the epic listing was cut short', async () => {
		const result = await epic_bundle_apply.apply_decision({
			...input({ action: 'create_epic' }),
			is_membership_established: false,
		})

		expect(result).toBe(SUCCESS_EXIT_CODE)
		expect(console.info).toHaveBeenCalledWith(epic_bundle_apply.WITHHELD_LINE)
		expect(mocked_create).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#8172: an unpublished split child reaches publishing only through an epic, so a
// placement that writes nothing fails with the steps that create one.
function required(
	bundle: Partial<BundleDecision>,
	overrides: Partial<ApplyInput> = {},
): ApplyInput {
	return { ...input(bundle), is_placement_required: true, ...overrides }
}

const NOTHING = 'nothing to place'
const CYCLE = 'a cycle'
const CUT = 'a cut listing'

describe('epic_bundle_apply.apply_decision — placement required', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
	})

	it.each([
		[NOTHING, required({ action: 'none' })],
		[CYCLE, required({ action: 'ask', epics: [EPIC_NUMBER] })],
		[CUT, required({ action: 'none' }, { is_membership_established: false })],
	])('fails with the epic steps on %s', async (_case, placement) => {
		expect(await epic_bundle_apply.apply_decision(placement)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(epic_bundle_apply.unplaced_line(SUBJECT_NUMBER))
		expect(epic_bundle_apply.unplaced_line(SUBJECT_NUMBER)).toContain(
			'`pnpm josh epic "<title>" 894`',
		)
		expect(epic_bundle_apply.unplaced_line(SUBJECT_NUMBER)).toContain('issue:file --publish <E>')
	})

	it.each([
		[NOTHING, { action: 'none' as const }, true],
		[CYCLE, { action: 'ask' as const }, true],
		[CUT, { action: 'none' as const }, false],
	])('succeeds on a subject an epic already tracks (%s)', async (_case, bundle, is_established) => {
		const subject = issue(SUBJECT_NUMBER, { epic: 880 })
		const tracked = required(bundle, { subject, is_membership_established: is_established })

		expect(await epic_bundle_apply.apply_decision(tracked)).toBe(SUCCESS_EXIT_CODE)
		expect(console.error).not.toHaveBeenCalled()
	})

	it('applies a settled placement as --apply does', async () => {
		const placement = required({ action: 'add_to_epic', epic: EPIC_NUMBER })

		expect(await epic_bundle_apply.apply_decision(placement)).toBe(SUCCESS_EXIT_CODE)
		expect(mocked_add).toHaveBeenCalledWith(expect.objectContaining({ epic_number: EPIC_NUMBER }))
	})
})
