import { git_gh_command } from '#scripts/gh/git-gh-command'
import { size_estimate } from '#scripts/issue/size-estimate'
import { split_measure } from '#scripts/split/split-measure'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_size_record } from './lane-size-record'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body_classified: vi.fn() },
}))
vi.mock('#scripts/split/split-measure', () => ({ split_measure: { read_branch: vi.fn() } }))
vi.mock('./lane-ledger-write', () => ({ lane_ledger_write: { record_size: vi.fn() } }))

afterEach(() => {
	vi.restoreAllMocks()
})

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(git_gh_command.issue_get_body_classified).mockResolvedValue({
		kind: 'read',
		text: '## 背景\n- 規模見積もり: 約 7 ファイル / 160 行（テスト除く）',
	})
	vi.mocked(split_measure.read_branch).mockResolvedValue({
		files: 13,
		lines: 300,
		verdict: 'split',
	})
})

describe('lane_size_record.record', () => {
	it('records declared and measured non-test size before merging, past the cap as missed', async () => {
		await lane_size_record.record(true, '5384')

		expect(lane_ledger_write.record_size).toHaveBeenCalledWith({
			issue: 5384,
			declared: { files: 7, lines: 160 },
			actual: { files: 13, lines: 300 },
			missed: true,
		})
	})

	it('skips a non-merging followup or absent issue', async () => {
		await lane_size_record.record(false, '5384')
		await lane_size_record.record(true, undefined)

		expect(git_gh_command.issue_get_body_classified).not.toHaveBeenCalled()
	})

	it.each(['', undefined])('skips an absent or empty body: %s', async (text) => {
		const declared_size = vi.spyOn(size_estimate, 'declared_size')

		vi.mocked(git_gh_command.issue_get_body_classified).mockResolvedValue({
			kind: 'read',
			text,
		})
		await lane_size_record.record(true, '5384')

		expect(declared_size).not.toHaveBeenCalledWith(undefined)
		expect(split_measure.read_branch).not.toHaveBeenCalled()
		expect(lane_ledger_write.record_size).not.toHaveBeenCalled()
	})

	it('does not block merging when measurement fails', async () => {
		vi.mocked(split_measure.read_branch).mockRejectedValue(new Error('unmeasurable'))

		await expect(lane_size_record.record(true, '5384')).resolves.toBeUndefined()
		expect(lane_ledger_write.record_size).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7579: only a diff past the split cap is a pre-split miss; the notice bar, declared ×
// the measured ratio, is not.
describe('lane_size_record.record against the cap', () => {
	it('records a diff past the notice bar but within the cap as not missed', async () => {
		vi.mocked(split_measure.read_branch).mockResolvedValue({
			files: 12,
			lines: 300,
			verdict: 'split',
		})

		await lane_size_record.record(true, '5384')

		expect(lane_ledger_write.record_size).toHaveBeenCalledWith(
			expect.objectContaining({ missed: false }),
		)
	})

	it('judges the cap of the measured guide', async () => {
		const guide = { files: 16, lines: 400, cap: { files: 24, lines: 600 } }

		vi.mocked(split_measure.read_branch).mockResolvedValue({
			files: 13,
			lines: 500,
			verdict: 'single',
			guide,
		})

		await lane_size_record.record(true, '5384')

		expect(lane_ledger_write.record_size).toHaveBeenCalledWith(
			expect.objectContaining({ missed: false }),
		)
	})

	it('records nothing for an Issue with no declared size', async () => {
		vi.mocked(git_gh_command.issue_get_body_classified).mockResolvedValue({
			kind: 'read',
			text: '## 背景\n- 種別: 非不具合',
		})

		await lane_size_record.record(true, '5384')

		expect(lane_ledger_write.record_size).not.toHaveBeenCalled()
	})
})
