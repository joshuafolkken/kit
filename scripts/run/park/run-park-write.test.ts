import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_write } from './run-park-write'

// `josh run:park`'s write: the `needs-decision` label, the comment and the local record.

const { apply_mock, record_mock } = vi.hoisted(() => ({
	apply_mock:
		vi.fn<
			(
				issue: string,
				label: string,
				body: string,
			) => Promise<{ is_labelled: boolean; is_commented: boolean }>
		>(),
	record_mock: vi.fn<(issue: string, directory: string) => boolean>(),
}))

vi.mock('#scripts/issue/issue-park', () => ({ issue_park: { apply: apply_mock } }))
vi.mock('./run-park', () => ({ run_park: { record: record_mock } }))
vi.mock('./run-park-lane', () => ({ run_park_lane: { with_lane_note: (body: string) => body } }))

const ISSUE = '6799'
const DIRECTORY = '/kit'
const OPTIONS = ['### 選択肢', '1. Resume the issue', '   - 層: C', '   - 必要な権限: 人'].join(
	'\n',
)
const BODY = `## Yield loop\n\n${OPTIONS}\n\n### 推奨\n推奨なし a person decides\n`

beforeEach(() => {
	apply_mock.mockReset().mockResolvedValue({ is_labelled: true, is_commented: true })
	record_mock.mockReset().mockReturnValue(true)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_park_write.write', () => {
	it('labels needs-decision, comments and records the park', async () => {
		await expect(
			run_park_write.write({ issue_number: ISSUE, body: BODY }, DIRECTORY),
		).resolves.toBe(true)
		expect(apply_mock).toHaveBeenCalledWith(ISSUE, 'needs-decision', BODY)
		expect(record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
	})

	it('records nothing when the comment did not land', async () => {
		apply_mock.mockResolvedValue({ is_labelled: true, is_commented: false })

		await expect(
			run_park_write.write({ issue_number: ISSUE, body: BODY }, DIRECTORY),
		).resolves.toBe(false)
		expect(record_mock).not.toHaveBeenCalled()
	})
})

describe('run_park_write.is_refused', () => {
	it('passes a body on the schema and refuses one off it', () => {
		expect(run_park_write.is_refused(BODY)).toBe(false)
		expect(run_park_write.is_refused('## Yield loop')).toBe(true)
	})
})
