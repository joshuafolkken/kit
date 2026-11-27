import { rmSync } from 'node:fs'
import path from 'node:path'
import { check_related_unplanned } from '#scripts/gate/check-related-unplanned'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_plan_probe } from '#scripts/lane/lane-plan-probe'
import { error_text } from '#scripts/lib/error-message'
import { file_reader } from '#scripts/lib/read-file'
import { run_review_unplanned } from '#scripts/run/review/run-review-unplanned'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unplanned_edit } from './unplanned-edit'

// joshuafolkken/kit#7640: #7618 met its unplanned file's holder only after a chain; the edit asks first.

const make_suite_directory = temporary_directory('suite')
const make_directory = temporary_directory()
const ROOT = make_suite_directory('unplanned-edit-')
const ISSUE = 7640
const LANE = path.join(ROOT, '.kit-lanes', String(ISSUE))
const JOSH_SCRATCH = path.join(LANE, '.josh')
const CHILD = { JOSH_LANE_CHILD: String(ISSUE) }
const PLANNED = 'scripts/hooks/planned.ts'
const UNPLANNED = 'scripts/gh/git-gh-pr-read.ts'
const YIELD_TEXT = '`lane:plan` would yield to #7620'
const PLAN = { issue: ISSUE, paths: [PLANNED], planned_at: '2026-11-16T00:00:00Z', cleared: true }

const refusal_to = vi.spyOn(run_review_unplanned, 'refusal_to')

function file_of(relative: string): string {
	return path.join(LANE, relative)
}

beforeEach(() => {
	rmSync(JOSH_SCRATCH, { recursive: true, force: true })
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(make_directory('repository-'))
	refusal_to.mockResolvedValue(YIELD_TEXT)
	lane_plan.record(PLAN, LANE)
})

describe('unplanned_edit.notice', () => {
	it("asks lane:plan at a lane child's first edit of an unplanned file, returning its yield", async () => {
		expect(await unplanned_edit.notice(file_of(UNPLANNED), LANE, CHILD)).toBe(YIELD_TEXT)
		expect(refusal_to).toHaveBeenCalledWith(LANE, expect.any(Function))
	})

	it('asks once per file, even when the yield widened nothing', async () => {
		await unplanned_edit.notice(file_of(UNPLANNED), LANE, CHILD)

		expect(await unplanned_edit.notice(file_of(UNPLANNED), LANE, CHILD)).toBeUndefined()
		expect(refusal_to).toHaveBeenCalledTimes(1)
	})

	it('answers nothing when the ask fails, leaving the hook its other context', async () => {
		refusal_to.mockRejectedValue(new Error('gh listing failed'))

		expect(await unplanned_edit.notice(file_of(UNPLANNED), LANE, CHILD)).toBeUndefined()
	})

	it('asks nothing on a planned file, a document, or a missing path', async () => {
		expect(await unplanned_edit.notice(file_of(PLANNED), LANE, CHILD)).toBeUndefined()
		expect(await unplanned_edit.notice(file_of('docs/why.md'), LANE, CHILD)).toBeUndefined()
		expect(await unplanned_edit.notice(undefined, LANE, CHILD)).toBeUndefined()
		expect(await unplanned_edit.notice(path.join(ROOT, 'scratch.ts'), LANE, CHILD)).toBeUndefined()
		expect(refusal_to).not.toHaveBeenCalled()
	})

	it('asks nothing outside a dispatched lane child, or with no plan recorded', async () => {
		expect(await unplanned_edit.notice(file_of(UNPLANNED), LANE, {})).toBeUndefined()
		expect(await unplanned_edit.notice(file_of(UNPLANNED), ROOT, CHILD)).toBeUndefined()
		expect(refusal_to).not.toHaveBeenCalled()
	})
})

describe('unplanned_edit.notice — swallowed failures', () => {
	it('records the ask failing, and an unreadable asked-note, once each', async () => {
		const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)

		refusal_to.mockRejectedValue(new Error('ask failed'))
		const read = vi.spyOn(file_reader, 'read_optional').mockImplementation(() => {
			throw new Error('note unreadable')
		})

		expect(await unplanned_edit.notice(file_of(UNPLANNED), LANE, CHILD)).toBeUndefined()
		expect(trace.mock.calls.map((call) => call[0])).toStrictEqual([
			'unplanned_edit.was_asked',
			'unplanned_edit.ask',
		])
		read.mockRestore()
		trace.mockRestore()
	})
})

describe('unplanned_edit.notice — a clear widening', () => {
	it('returns the widening line, and the next edit of the file asks nothing', async () => {
		refusal_to.mockRestore()
		vi.spyOn(check_related_unplanned, 'read_unplanned').mockResolvedValue({
			issue: ISSUE,
			files: [UNPLANNED],
			text: 'unplanned',
		})
		vi.spyOn(lane_plan_probe, 'extend').mockImplementation(async (plan, directory) => {
			lane_plan.record({ ...plan, cleared: true }, directory)

			return await undefined
		})

		expect(await unplanned_edit.notice(file_of(UNPLANNED), LANE, CHILD)).toContain(
			`lane:plan widened by ${UNPLANNED}`,
		)
		expect(await unplanned_edit.notice(file_of(UNPLANNED), LANE, CHILD)).toBeUndefined()
		expect(lane_plan_probe.extend).toHaveBeenCalledTimes(1)
	})
})
