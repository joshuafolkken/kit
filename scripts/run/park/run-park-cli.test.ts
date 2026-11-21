import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { answer_judge, type JudgePorts } from '#scripts/agent/answer-judge'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import { issue_sources } from '#scripts/issue/issue-sources'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkCheck, run_park_answered } from './run-park-answered'
import { run_park_cli } from './run-park-cli'

const make_directory = temporary_directory('suite')

const {
	apply_mock,
	clear_label_mock,
	record_mock,
	clear_record_mock,
	release_mock,
	lane_note_mock,
	print_once_mock,
	refusal_mock,
	actual_refusal,
} = vi.hoisted(() => ({
	actual_refusal: vi.fn<typeof run_park_answered.refusal_of>(),
	refusal_mock: vi.fn<(issue: string, question: string, directory: string) => Promise<ParkCheck>>(),
	print_once_mock: vi.fn<(key: string, root?: string) => number>(),
	lane_note_mock: vi.fn<(body: string, directory: string) => string>(),
	apply_mock:
		vi.fn<
			(
				issue: string,
				label: string,
				body: string,
			) => Promise<{ is_labelled: boolean; is_commented: boolean }>
		>(),
	clear_label_mock: vi.fn<(issue: string, label: string) => Promise<boolean>>(),
	record_mock: vi.fn<(issue: string, directory: string) => boolean>(),
	clear_record_mock: vi.fn<(issue: string, directory: string) => void>(),
	release_mock: vi.fn<(issue: string) => Promise<number>>(),
}))

vi.mock('#scripts/issue/issue-park', () => ({ issue_park: { apply: apply_mock } }))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_clear_label: clear_label_mock },
}))
vi.mock('./run-park', () => ({ run_park: { record: record_mock, clear: clear_record_mock } }))
vi.mock('./run-park-release', () => ({ run_park_release: { release: release_mock } }))
vi.mock('./run-park-lane', () => ({ run_park_lane: { with_lane_note: lane_note_mock } }))
vi.mock('./run-park-answered', async (import_original) => {
	const original = await import_original<{ run_park_answered: typeof run_park_answered }>()

	actual_refusal.mockImplementation(original.run_park_answered.refusal_of)

	return { run_park_answered: { refusal_of: refusal_mock } }
})
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { PARK: 'run:park', print_once: print_once_mock },
}))

const ISSUE = '4132'
const LABEL = 'needs-decision'
const DIRECTORY = '/lane/4132'
const WORK_DIRECTORY = make_directory('run-park-cli-')
const BODY_FILE = path.join(WORK_DIRECTORY, 'park.md')
const QUESTION = 'Which option?'
const OPTIONS = [
	'### 選択肢',
	'1. Keep the account',
	'   - 層: A',
	'   - 必要な権限: owner コメント',
	'2. Rotate the account',
	'   - 層: C',
	'   - 必要な権限: 人',
].join('\n')
const PICK = '### 推奨\n1 cheaper and reversible'
const BODY = `## ${QUESTION}\n\n${OPTIONS}\n\n${PICK}\n`
const BODY_FILE_FLAG = '--body-file'
const NEXT = 'pnpm josh backlog:triage --apply 7447 --blocked-by 7839'
const OUTCOME_FLAG = '--outcome'
const PARK_ARGV = [ISSUE, BODY_FILE_FLAG, BODY_FILE, OUTCOME_FLAG, NEXT]
const MARKED_BODY = issue_outcome.body_of({ body: BODY, summary: NEXT })
const LANE_BODY = `${QUESTION}\n\n---\n- Lane directory: \`${DIRECTORY}\`\n`

writeFileSync(BODY_FILE, BODY)

beforeEach(() => {
	writeFileSync(BODY_FILE, BODY)
	apply_mock.mockReset().mockResolvedValue({ is_labelled: true, is_commented: true })
	clear_label_mock.mockReset().mockResolvedValue(true)
	record_mock.mockReset().mockReturnValue(true)
	clear_record_mock.mockReset()
	release_mock.mockReset().mockResolvedValue(0)
	lane_note_mock.mockReset().mockImplementation((body) => body)
	print_once_mock.mockReset().mockReturnValue(0)
	refusal_mock.mockReset().mockResolvedValue(undefined)
})

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

// joshuafolkken/kit#6669: the contract is inverted — a body off the schema is refused, a
// recommendation is required.
describe('run:park body schema', () => {
	it.each([
		['no recommendation section', `${QUESTION}\n\n${OPTIONS}\n`, '### 推奨 needs one line'],
		['an option with no tier', `${OPTIONS.replace('   - 層: C\n', '')}\n\n${PICK}`, 'option 2'],
	])('refuses a body with %s before any park write', async (_case, body, problem) => {
		writeFileSync(BODY_FILE, body)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(apply_mock).not.toHaveBeenCalled()
		expect(record_mock).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(problem))
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Park body schema:'))
	})

	it.each([PICK, '### 推奨\n推奨なし both need the owner'])(
		'parks a body whose recommendation reads %j',
		async (pick) => {
			writeFileSync(BODY_FILE, `${OPTIONS}\n\n${pick}\n`)

			await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
			expect(apply_mock).toHaveBeenCalledWith(ISSUE, LABEL, expect.stringContaining(pick))
		},
	)

	it('shows the body schema in the usage', () => {
		expect(run_park_cli.USAGE).toContain('### 選択肢')
		expect(run_park_cli.USAGE).toContain('### 推奨')
	})
})

// joshuafolkken/kit#7850: the park writes its next action as the board's outcome marker.
describe('run:park next action', () => {
	it('writes the next action as the josh:outcome marker', async () => {
		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(apply_mock).toHaveBeenCalledWith(ISSUE, LABEL, MARKED_BODY)
		expect(issue_outcome.next_of(MARKED_BODY)).toBe(NEXT)
	})

	it('names --outcome and its format in the usage', () => {
		expect(run_park_cli.USAGE).toContain('--body-file <path> --outcome "<next action>"')
		expect(run_park_cli.USAGE).toContain(issue_outcome.NEXT_FORMAT)
	})

	it.each([
		['no next action', []],
		['prose with no leading word', [OUTCOME_FLAG, 'close the lane']],
		['an overlong command', [OUTCOME_FLAG, `pnpm josh ${'x'.repeat(issue_outcome.NEXT_LIMIT)}`]],
	])('refuses a park with %s before any write', async (_case, outcome) => {
		await expect(
			run_park_cli.run([ISSUE, BODY_FILE_FLAG, BODY_FILE, ...outcome], DIRECTORY),
		).resolves.toBe(1)
		expect(apply_mock).not.toHaveBeenCalled()
		expect(refusal_mock).not.toHaveBeenCalled()
	})

	it('shows the next-action format on a refusal', async () => {
		await run_park_cli.run([ISSUE, BODY_FILE_FLAG, BODY_FILE], DIRECTORY)

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(issue_outcome.NEXT_FORMAT))
	})
})

function mock_judgment_sources(): void {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(issue_sources, 'read_sources').mockResolvedValue({
		kind: 'sources',
		sources: [],
		untrusted_count: 0,
	})
}

// joshuafolkken/kit#6531: the question is judged against the Issue before any write.
describe('run:park usage limit', () => {
	it('records and releases a park from a real usage-limit judgment log', async () => {
		const { judge } = answer_judge
		const ports: JudgePorts = {
			profile: () => ({ kind: 'profile', profile: agent_role_profile.DEFAULT_PROFILES.reviewer }),
			launch: async () => ({ kind: 'completed', pid: 1, exit_code: 1 }),
			read_log: () =>
				'{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","rateLimitType":"seven_day"}}\n{"type":"assistant","error":"rate_limit"}',
			log_path: () => 'judgment.log',
		}

		mock_judgment_sources()
		vi.spyOn(answer_judge, 'judge').mockImplementation(
			async (request) => await judge(request, ports),
		)
		refusal_mock.mockImplementation(actual_refusal)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(apply_mock).toHaveBeenCalledWith(ISSUE, LABEL, expect.stringContaining('usage limit:'))
		expect(record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
		expect(release_mock).toHaveBeenCalledWith(ISSUE)
	})
})

describe('run:park answered question', () => {
	it('judges the question as written, before the lane note and any write', async () => {
		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(refusal_mock).toHaveBeenCalledWith(ISSUE, MARKED_BODY, DIRECTORY)
		expect(refusal_mock.mock.invocationCallOrder[0]).toBeLessThan(
			apply_mock.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('writes, records and releases nothing when the judgment stops the park', async () => {
		refusal_mock.mockResolvedValue({ exit_code: 1 })

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(apply_mock).not.toHaveBeenCalled()
		expect(record_mock).not.toHaveBeenCalled()
		expect(release_mock).not.toHaveBeenCalled()
	})

	it('does not judge a body off the schema', async () => {
		writeFileSync(BODY_FILE, `${QUESTION}\n\n${OPTIONS}\n`)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(refusal_mock).not.toHaveBeenCalled()
	})

	it('does not judge a clear', async () => {
		await expect(run_park_cli.run([ISSUE, '--clear'], DIRECTORY)).resolves.toBe(0)
		expect(refusal_mock).not.toHaveBeenCalled()
		expect(clear_record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
	})
})

// joshuafolkken/kit#4132: one call parks a lane child, and one call takes the park back off.
describe('run:park', () => {
	it('comments, applies needs-decision and records the park', async () => {
		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(apply_mock).toHaveBeenCalledWith(ISSUE, LABEL, expect.stringContaining(QUESTION))
		expect(record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
	})

	// The guard falls silent on a record, so only a park with both halves on the issue is recorded.
	it.each([
		[{ is_labelled: false, is_commented: false }],
		[{ is_labelled: true, is_commented: false }],
	])('fails and records nothing when the write is %j', async (write) => {
		apply_mock.mockResolvedValue(write)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(record_mock).not.toHaveBeenCalled()
	})

	it.each([[[ISSUE]], [[BODY_FILE_FLAG, BODY_FILE]], [['abc', BODY_FILE_FLAG, BODY_FILE]]])(
		'refuses %j with the usage',
		async (argv) => {
			await expect(run_park_cli.run(argv, DIRECTORY)).resolves.toBe(1)
			expect(apply_mock).not.toHaveBeenCalled()
			expect(console.error).toHaveBeenCalledWith(run_park_cli.USAGE)
		},
	)
})

// joshuafolkken/kit#5840: the comment carries the lane note `run_park_lane` appends.
describe('run:park lane note', () => {
	it('posts the body with the lane note appended', async () => {
		lane_note_mock.mockReturnValue(LANE_BODY)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(lane_note_mock).toHaveBeenCalledWith(MARKED_BODY, DIRECTORY)
		expect(apply_mock).toHaveBeenCalledWith(ISSUE, LABEL, LANE_BODY)
	})
})

// joshuafolkken/kit#5737: every parked ending owes the release, so the park runs it.
describe('run:park release', () => {
	it('releases the hold after the park is recorded', async () => {
		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(release_mock).toHaveBeenCalledWith(ISSUE)
		expect(record_mock.mock.invocationCallOrder[0]).toBeLessThan(
			release_mock.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('leaves the hold alone when the park did not land', async () => {
		apply_mock.mockResolvedValue({ is_labelled: true, is_commented: false })

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(release_mock).not.toHaveBeenCalled()
	})

	it('keeps the park and exits non-zero when the release fails', async () => {
		release_mock.mockResolvedValue(1)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
		expect(clear_record_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#5842: a released park prints "park and continue" once per session.
describe('run:park section', () => {
	it('prints the park section after the release', async () => {
		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(print_once_mock).toHaveBeenCalledExactlyOnceWith('run:park', DIRECTORY)
		expect(release_mock.mock.invocationCallOrder[0]).toBeLessThan(
			print_once_mock.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('prints no section when the release fails', async () => {
		release_mock.mockResolvedValue(1)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(print_once_mock).not.toHaveBeenCalled()
	})

	it('fails when the section does not resolve', async () => {
		print_once_mock.mockReturnValue(1)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
	})

	it('prints no section for a clear', async () => {
		await expect(run_park_cli.run([ISSUE, '--clear'], DIRECTORY)).resolves.toBe(0)
		expect(print_once_mock).not.toHaveBeenCalled()
	})
})

describe('run:park --clear', () => {
	it('removes needs-decision and the record', async () => {
		await expect(run_park_cli.run([ISSUE, '--clear'], DIRECTORY)).resolves.toBe(0)
		expect(clear_label_mock).toHaveBeenCalledWith(ISSUE, LABEL)
		expect(clear_record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
		expect(release_mock).not.toHaveBeenCalled()
	})

	// `issue_clear_label` answers `true` for a label that is already off, so the clear succeeds.
	it('fails when the label is still on, and clears the record anyway', async () => {
		clear_label_mock.mockResolvedValue(false)

		await expect(run_park_cli.run([ISSUE, '--clear'], DIRECTORY)).resolves.toBe(1)
		expect(clear_record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
	})

	it('refuses a clear with no issue', async () => {
		await expect(run_park_cli.run(['--clear'], DIRECTORY)).resolves.toBe(1)
		expect(clear_label_mock).not.toHaveBeenCalled()
	})
})
