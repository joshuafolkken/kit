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
	vi.clearAllMocks()
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
