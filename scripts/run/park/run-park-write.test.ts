import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_write } from './run-park-write'

// joshuafolkken/kit#6531: backlog:drive's yield-cap park is a system stop — written, recorded and
// released without the answered-question judgment `josh run:park` runs, and without its section.

const { apply_mock, record_mock, release_mock, refusal_mock, print_once_mock } = vi.hoisted(() => ({
	apply_mock:
		vi.fn<
			(
				issue: string,
				label: string,
				body: string,
			) => Promise<{ is_labelled: boolean; is_commented: boolean }>
		>(),
	record_mock: vi.fn<(issue: string, directory: string) => boolean>(),
	release_mock: vi.fn<(issue: string) => Promise<number>>(),
	refusal_mock: vi.fn<() => Promise<number | undefined>>(),
	print_once_mock: vi.fn<() => number>(),
}))

vi.mock('#scripts/issue/issue-park', () => ({ issue_park: { apply: apply_mock } }))
vi.mock('./run-park', () => ({ run_park: { record: record_mock } }))
vi.mock('./run-park-release', () => ({ run_park_release: { release: release_mock } }))
vi.mock('./run-park-lane', () => ({ run_park_lane: { with_lane_note: (body: string) => body } }))
vi.mock('./run-park-answered', () => ({ run_park_answered: { refusal_of: refusal_mock } }))
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { PARK: 'run:park', print_once: print_once_mock },
}))

const ISSUE = '6799'
const DIRECTORY = '/kit'
const OPTIONS = ['### 選択肢', '1. Resume the issue', '   - 層: C', '   - 必要な権限: 人'].join(
	'\n',
)
const BODY = `## Yield loop\n\n${OPTIONS}\n\n### 推奨\n推奨なし a person decides\n`

beforeEach(() => {
	apply_mock.mockReset().mockResolvedValue({ is_labelled: true, is_commented: true })
	record_mock.mockReset().mockReturnValue(true)
	release_mock.mockReset().mockResolvedValue(0)
	refusal_mock.mockReset()
	print_once_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_park_write system_stop', () => {
	it('writes, records and releases the park without the judgment or the section', async () => {
		const request = { issue_number: ISSUE, body: BODY }

		await expect(run_park_write.system_stop(request, DIRECTORY)).resolves.toBe(0)
		expect(apply_mock).toHaveBeenCalledWith(ISSUE, 'needs-decision', BODY)
		expect(record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
		expect(release_mock).toHaveBeenCalledWith(ISSUE)
		expect(refusal_mock).not.toHaveBeenCalled()
		expect(print_once_mock).not.toHaveBeenCalled()
	})

	it('refuses a body off the schema before any write', async () => {
		const request = { issue_number: ISSUE, body: '## Yield loop' }

		await expect(run_park_write.system_stop(request, DIRECTORY)).resolves.toBe(1)
		expect(apply_mock).not.toHaveBeenCalled()
	})

	it('releases nothing when the label or the comment did not land', async () => {
		apply_mock.mockResolvedValue({ is_labelled: true, is_commented: false })

		await expect(
			run_park_write.system_stop({ issue_number: ISSUE, body: BODY }, DIRECTORY),
		).resolves.toBe(1)
		expect(record_mock).not.toHaveBeenCalled()
		expect(release_mock).not.toHaveBeenCalled()
	})
})
