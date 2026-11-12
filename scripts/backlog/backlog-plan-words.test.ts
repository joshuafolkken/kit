import { auto_ok_fixture } from '#scripts/auto-ok/auto-ok-fixture'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_report } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_plan, type PlanContext } from './backlog-plan'
import { backlog_plan_cap_fixture } from './backlog-plan-cap-fixture'
import { backlog_plan_cli } from './backlog-plan-cli'
import { backlog_plan_words } from './backlog-plan-words'

// joshuafolkken/kit#5844: `backlog:plan` prints its sections in the session language, so the plan is
// relayed as printed rather than reworded.

const JA = backlog_plan_words.JAPANESE_PLAN_WORDS
const EN = backlog_plan_words.ENGLISH_PLAN_WORDS
const BLOCKER = 901
const WAITING_CHILD = 902
const NAMED = { issues: [], only: false }
const EMPTY_POOL = { runnable: [], time: [], human: [] }

function japanese_context(): PlanContext {
	return { repo: backlog_fixture.REPO, titles: new Map(), open_numbers: undefined, words: JA }
}

function waiting_child(labels: ReadonlyArray<string>): EpicChild {
	return {
		number: WAITING_CHILD,
		repo: backlog_fixture.REPO,
		state: 'OPEN',
		labels: [...labels],
		blocked_by: [{ repo: backlog_fixture.REPO, number: BLOCKER }],
	}
}

describe('backlog_plan_words — the table per session language', () => {
	it.each([
		['ja', JA],
		['ja-JP', JA],
		['en', EN],
		['fr', EN],
	])('reads %s as its table', (lang, words) => {
		expect(backlog_plan_words.words_for(lang)).toBe(words)
	})

	it('reads the session language from JOSH_SESSION_LANG', () => {
		vi.stubEnv('JOSH_SESSION_LANG', 'en')

		expect(backlog_plan_words.session_words()).toBe(EN)
	})
})

describe('backlog_plan_cli.run — unreadable lane limit', () => {
	it.each([
		['ja', 'レーン上限内'],
		['en', 'within the lane limit'],
	])(
		'does not promise a lane bound when the limit is unreadable in %s',
		async (lang, guarantee) => {
			vi.restoreAllMocks()
			vi.stubEnv('JOSH_SESSION_LANG', lang)
			backlog_plan_cap_fixture.stub()
			vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'problem', problem: 'bad' })
			const streams = auto_ok_fixture.console_streams()

			vi.spyOn(console, 'info').mockImplementation(streams.info)
			await backlog_plan_cli.run([])
			const ready =
				streams.stdout().split(backlog_plan_words.words_for(lang).waiting_heading)[0] ?? ''

			expect(backlog_plan_cap_fixture.numbers_in(ready)).toHaveLength(
				backlog_plan_cap_fixture.ORDERED.length,
			)
			expect(ready).not.toContain(guarantee)
		},
	)
})

describe('backlog_plan_cli.run — in the session language', () => {
	it('prints the plan in Japanese under JOSH_SESSION_LANG=ja', async () => {
		const streams = auto_ok_fixture.console_streams()

		vi.stubEnv('JOSH_SESSION_LANG', 'ja')
		vi.spyOn(console, 'info').mockImplementation(streams.info)
		backlog_fixture.stub_backlog({ opted_in: [] })
		vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
			json: '[]',
			is_capped: false,
		})

		await backlog_plan_cli.run([])

		expect(streams.stdout()).toContain(JA.ready_heading)
		expect(streams.stdout()).not.toContain(EN.ready_heading)
	})
})

describe('backlog_plan.format_plan — in the Japanese table', () => {
	it('prints the title and the four headings in Japanese', () => {
		const result = epic_report.build_result(EMPTY_POOL, [])
		const text = backlog_plan.format_plan(result, [], japanese_context(), NAMED)

		expect(text.split('\n', 1)[0]).toBe(`${JA.title} — ${backlog_fixture.REPO}`)

		for (const heading of [JA.ready_heading, JA.waiting_heading, JA.human_heading]) {
			expect(text).toContain(`${heading}\n    ${JA.nothing}`)
		}

		expect(text).toContain(JA.scope_heading)
		expect(text).not.toContain(EN.ready_heading)
	})

	it('writes a waiting row note in Japanese', () => {
		const context = japanese_context()

		expect(backlog_plan.waiting_note(waiting_child([]), context)).toBe(
			`${JA.waiting_on} [#${String(BLOCKER)}](https://github.com/${backlog_fixture.REPO}/issues/${String(BLOCKER)})`,
		)
		expect(backlog_plan.waiting_note(waiting_child([IN_PROGRESS_LABEL]), context)).toBe(
			JA.in_progress_note,
		)
	})

	it('prints the --only heading in Japanese', () => {
		const result = epic_report.build_result(EMPTY_POOL, [])
		const text = backlog_plan.format_plan(result, [], japanese_context(), {
			issues: [BLOCKER],
			only: true,
		})

		expect(text).toContain(JA.only_named_heading)
	})
})
