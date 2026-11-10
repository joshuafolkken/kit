import { issue_read } from '#scripts/issue/issue-read'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_triage_park } from './backlog-triage-park'

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: vi.fn(async () => '[]') },
}))
vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: { parse_comments: vi.fn(), trusted_bodies: vi.fn() },
}))
vi.mock('#scripts/issue/session-cite', () => ({
	session_cite: { issue: (number: string): string => `#${number}` },
}))

const ISSUE = 901
const OPTIONS = [
	'### 選択肢',
	'1. Keep it',
	'   - 層: A',
	'   - 必要な権限: なし',
	'2. Rotate it',
	'   - 層: C',
	'   - 必要な権限: 人',
].join('\n')
const PICK_ONE = '1 cheaper'
const PICK_TWO = '2 the key leaked'
const TIER_C_SUMMARY = '推奨: 2（層 C）'
const OFF_SCHEMA = 'Which option?'
const ADOPT_LINE = `pnpm josh backlog:triage --apply ${String(ISSUE)} --adopt 1 --reason <text>`

function park(pick: string): string {
	return `## Which?\n\n${OPTIONS}\n\n### 推奨\n${pick}\n`
}

function parked_with(bodies: ReadonlyArray<string> | undefined): void {
	vi.mocked(issue_read.parse_comments).mockResolvedValue(bodies === undefined ? undefined : [])
	vi.mocked(issue_read.trusted_bodies).mockReturnValue(bodies ?? [])
}

beforeEach(() => {
	parked_with([])
})

describe('backlog_triage_park.lines_of', () => {
	it('prints the recommendation, its tier and the --adopt line (ac-6a5178a8)', async () => {
		parked_with([park(PICK_ONE)])

		expect(await backlog_triage_park.lines_of(ISSUE)).toStrictEqual([
			`#${String(ISSUE)} 推奨: 1（層 A）`,
			ADOPT_LINE,
		])
	})

	it.each([
		['no recommendation', '推奨なし the owner decides', '推奨なし'],
		['a tier C recommendation', PICK_TWO, TIER_C_SUMMARY],
	])('prints no --adopt line for %s (ac-d69f6e84)', async (_case, pick, summary) => {
		parked_with([park(pick)])

		expect(await backlog_triage_park.lines_of(ISSUE)).toStrictEqual([
			`#${String(ISSUE)} ${summary}`,
		])
	})

	it('reads the latest park that meets the schema', async () => {
		parked_with([park(PICK_ONE), park(PICK_TWO), OFF_SCHEMA])

		expect(await backlog_triage_park.lines_of(ISSUE)).toStrictEqual([
			`#${String(ISSUE)} ${TIER_C_SUMMARY}`,
		])
	})

	it.each([
		['a park off the schema', [OFF_SCHEMA]],
		['comments it cannot read', undefined],
	])('prints nothing for %s', async (_case, bodies) => {
		parked_with(bodies)

		expect(await backlog_triage_park.lines_of(ISSUE)).toStrictEqual([])
	})
})

describe('backlog_triage_park.read', () => {
	it.each([
		['unreadable comments', undefined, 'could not read its comments'],
		['no park body', [OFF_SCHEMA], 'no trusted comment follows the park body schema'],
	])('names %s', async (_case, bodies, problem) => {
		parked_with(bodies)

		expect(await backlog_triage_park.read(String(ISSUE))).toStrictEqual({ problem })
	})
})

// joshuafolkken/kit#7001: `--adopt` refuses an option needing the parent's action without `--done`.
describe("backlog_triage_park.lines_of — an option needing the parent's action", () => {
	it('adds --done to its --adopt line', async () => {
		parked_with([park(PICK_ONE).replace('必要な権限: なし', '必要な権限: 親')])

		expect(await backlog_triage_park.lines_of(ISSUE)).toStrictEqual([
			`#${String(ISSUE)} 推奨: 1（層 A · 親の操作）`,
			`${ADOPT_LINE} --done <the parent action taken>`,
		])
	})
})
