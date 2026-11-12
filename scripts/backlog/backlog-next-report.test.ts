import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { auto_ok_fixture } from '#scripts/auto-ok/auto-ok-fixture'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_next_report } from './backlog-next-report'

// The printing half of `backlog:next`. The end-to-end answers are pinned by `backlog-next.test.ts`;
// these cover the pieces that suite reaches only through a whole stubbed backlog.

const REPO = 'owner/here'
const OTHER_REPO = 'owner/elsewhere'
const TRIAGED_NUMBER = 11
const UNTRIAGED_NUMBER = 12

const streams = auto_ok_fixture.console_streams()

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	streams.reset()
})

function child(number: number, repo: string, labels: ReadonlyArray<string>): EpicChild {
	return { number, repo, state: 'OPEN', labels, blocked_by: [] }
}

function run_result(children: ReadonlyArray<EpicChild>): EpicNextResult {
	const repos = [...new Set(children.map((row) => row.repo))]
	const candidates = repos.map((repo) => ({
		repo,
		children: children.filter((row) => row.repo === repo),
	}))

	return { verdict: 'run', candidates, waiting: [], blocked_on_people: [], anomalies: [] }
}

describe('backlog_next_report.report_none — nobody opted in', () => {
	it('prints the none token on standard output and the reason on standard error', () => {
		expect(backlog_next_report.report_none()).toBe(0)
		expect(streams.stdout()).toBe(auto_ok_cli.NONE_TOKEN)
		expect(streams.stderr()).toBe(auto_ok_cli.NONE_OPTED_IN_MESSAGE)
	})
})

describe('backlog_next_report.without_untriaged — the held-out candidates', () => {
	it("drops only this repository's untriaged candidates", () => {
		const result = run_result([
			child(TRIAGED_NUMBER, REPO, [RUN_LANE_LABEL]),
			child(UNTRIAGED_NUMBER, REPO, []),
			child(UNTRIAGED_NUMBER, OTHER_REPO, []),
		])
		const kept = backlog_next_report.without_untriaged(result, REPO)
		const numbers = kept.candidates.map((bucket) => bucket.children.map((row) => row.number))

		expect(numbers).toStrictEqual([[TRIAGED_NUMBER], [UNTRIAGED_NUMBER]])
	})
})
