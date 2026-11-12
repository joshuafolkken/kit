import { beforeEach, describe, expect, it, vi } from 'vitest'

const { order, requeue, carry } = vi.hoisted(() => ({
	order: new Array<string>(),
	requeue: { code: 0 },
	carry: { kind: 'carried' },
}))

vi.mock('#scripts/run/carry/run-carry', () => ({
	run_carry: {
		repository_directory: vi.fn(async () => '/repo/.git'),
		carry_path: vi.fn(() => '/repo/.git/carry'),
		read_carry: vi.fn(() => carry),
	},
}))
vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_list_comments: vi.fn(async () => '[]') },
}))
vi.mock('#scripts/issue/issue-read', () => ({
	issue_read: { parse_comments: vi.fn(), trusted_bodies: vi.fn() },
}))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { listing_epics: vi.fn() },
}))
vi.mock('#scripts/epic/epic-decide', () => ({
	epic_decide: {
		decide: vi.fn(async () => {
			order.push('decide')

			return 0
		}),
	},
}))
vi.mock('#scripts/run/park/run-park', () => ({
	run_park: {
		clear: vi.fn(() => {
			order.push('clear')
		}),
	},
}))
vi.mock('./backlog-triage-approval', () => ({
	backlog_triage_approval: {
		write: vi.fn(async () => {
			order.push('approval')

			return '/repo/.josh/tmp/size-approval-6670.json'
		}),
	},
}))
vi.mock('#scripts/josh/josh-run', () => ({
	josh_command: {
		josh_run: vi.fn(async () => {
			order.push('run:add')

			return await { code: requeue.code }
		}),
	},
}))

const { issue_read } = await import('#scripts/issue/issue-read')
const { epic_blocked_by } = await import('#scripts/epic/epic-blocked-by')
const { epic_decide } = await import('#scripts/epic/epic-decide')
const { josh_command } = await import('#scripts/josh/josh-run')
const { backlog_triage_approval } = await import('./backlog-triage-approval')
const { backlog_triage_cli } = await import('./backlog-triage-cli')

const ISSUE = '6670'
const EPIC = 6672
const DIRECTORY = '/repo'
const REASON = 'the parent takes the recommendation'
const OPTIONS = [
	'### 選択肢',
	'1. Keep the lane',
	'   - 層: A',
	'   - 必要な権限: なし',
	'2. Rotate the token',
	'   - 層: C',
	'   - 必要な権限: 信頼設定',
].join('\n')
const PARK = `## Which lane?\n\n${OPTIONS}\n\n### 推奨\n1 cheaper\n`
const NO_PICK_PARK = `## Which lane?\n\n${OPTIONS}\n\n### 推奨\n推奨なし both need a person\n`

function adopt_argv(option: string): ReadonlyArray<string> {
	return ['--apply', ISSUE, '--adopt', option, '--reason', REASON]
}

async function adopt(option = '1'): Promise<number> {
	return await backlog_triage_cli.run(adopt_argv(option), DIRECTORY)
}

beforeEach(() => {
	order.length = 0
	requeue.code = 0
	carry.kind = 'carried'
	vi.mocked(issue_read.parse_comments).mockResolvedValue([])
	vi.mocked(issue_read.trusted_bodies).mockReturnValue(['an earlier note', PARK])
	vi.mocked(epic_blocked_by.listing_epics).mockResolvedValue([EPIC])
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

// joshuafolkken/kit#6670: a parent takes a park option in one call.
describe('backlog:triage --apply --adopt', () => {
	it('records the decision, clears the park, then requeues the child (ac-8af808d0)', async () => {
		await expect(adopt()).resolves.toBe(0)

		expect(order).toStrictEqual(['decide', 'clear', 'run:add'])
		expect(epic_decide.decide).toHaveBeenCalledWith({
			epic_number: EPIC,
			children: [Number(ISSUE)],
			decision: `#${ISSUE}: adopted park option 1 (backlog:triage --adopt) — ${REASON}`,
		})
		expect(josh_command.josh_run).toHaveBeenCalledWith(['run:add', ISSUE, '--retry'], true)
	})

	it.each([
		['a tier C option (ac-77bc914f)', '2', [PARK], 'option 2 is tier C'],
		['an unlisted option (ac-77bc914f)', '3', [PARK], '### 選択肢 lists no option 3'],
		['a park with no recommendation (ac-77bc914f)', '1', [NO_PICK_PARK], '推奨なし'],
		['an issue with no park body', '1', ['a plain note'], 'no trusted comment follows'],
	])('refuses %s before any write', async (_case, option, bodies, problem) => {
		vi.mocked(issue_read.trusted_bodies).mockReturnValue(bodies)

		await expect(adopt(option)).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(problem))
	})

	it.each([
		['no epic', [], '0 epics track it'],
		['two epics', [EPIC, EPIC + 1], '2 epics track it'],
	])('refuses a child tracked by %s before any write', async (_case, epics, problem) => {
		vi.mocked(epic_blocked_by.listing_epics).mockResolvedValue(epics)

		await expect(adopt()).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(problem))
	})
})

describe('backlog:triage --apply --adopt — no live run', () => {
	it('refuses before any write when no backlogrun is running here to requeue it', async () => {
		carry.kind = 'none'

		await expect(adopt()).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no backlogrun'))
	})
})

describe('backlog:triage --apply --adopt — reads and failures', () => {
	it('refuses before any write when the comments cannot be read', async () => {
		vi.mocked(issue_read.parse_comments).mockResolvedValue(undefined)

		await expect(adopt()).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not read'))
	})

	it('reads the latest park body when the child parked twice', async () => {
		vi.mocked(issue_read.trusted_bodies).mockReturnValue([PARK, NO_PICK_PARK])

		await expect(adopt()).resolves.toBe(1)
	})

	it('hands a re-run the same decision, which epic --decide skips once recorded (ac-ab0550f5)', async () => {
		await adopt()
		await adopt()

		const [first, second] = vi.mocked(epic_decide.decide).mock.calls

		expect(second).toStrictEqual(first)
	})

	it('stops before the park when the decision is not recorded', async () => {
		vi.mocked(epic_decide.decide).mockResolvedValueOnce(1)

		await expect(adopt()).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('nothing after it'))
	})

	it('names what was written when the requeue fails', async () => {
		requeue.code = 1

		await expect(adopt()).resolves.toBe(1)

		expect(order).toStrictEqual(['decide', 'clear', 'run:add'])
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('decision recorded and park cleared'),
		)
	})
})

// joshuafolkken/kit#6776: an option carrying a size-approval range writes the approval first.
const RANGE_LINES = [
	'   - 規模承認のパス: `scripts/a.ts`',
	'   - 規模承認の行数: 150 / 260',
	'   - 規模承認のファイル数: 4 / 6',
]
const APPROVAL_PARK = PARK.replace('2. Rotate', () => `${RANGE_LINES.join('\n')}\n2. Rotate`)

describe('backlog:triage --apply --adopt — a size-approval option', () => {
	it('writes the approval before the decision and names its json (ac-65c53234)', async () => {
		vi.mocked(issue_read.trusted_bodies).mockReturnValue([APPROVAL_PARK])

		await expect(adopt()).resolves.toBe(0)

		expect(order).toStrictEqual(['approval', 'decide', 'clear', 'run:add'])
		expect(backlog_triage_approval.write).toHaveBeenCalledWith({
			issue: ISSUE,
			reason: REASON,
			range: {
				paths: ['scripts/a.ts'],
				lines: { declared: 150, max: 260 },
				files: { declared: 4, max: 6 },
			},
			comments: [],
		})
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('size approval /repo/.josh/tmp/size-approval-6670.json'),
		)
	})

	it('writes no approval for an option that carries no range', async () => {
		await expect(adopt()).resolves.toBe(0)

		expect(backlog_triage_approval.write).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7001: an option needing the parent's own action is taken before the child resumes.
const PARENT_PARK = PARK.replace('必要な権限: なし', '必要な権限: 親セッション')
const DONE = 'filed #7010 and closed the child'

describe("backlog:triage --apply --adopt — an option needing the parent's action", () => {
	it('refuses it without --done before any write, so the child stays parked (ac-ec188a74)', async () => {
		vi.mocked(issue_read.trusted_bodies).mockReturnValue([PARENT_PARK])

		await expect(adopt()).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("the parent's own action"))
	})

	it('records the action taken with --done, then requeues the child (ac-ec188a74)', async () => {
		vi.mocked(issue_read.trusted_bodies).mockReturnValue([PARENT_PARK])

		await expect(
			backlog_triage_cli.run([...adopt_argv('1'), '--done', DONE], DIRECTORY),
		).resolves.toBe(0)

		expect(order).toStrictEqual(['decide', 'clear', 'run:add'])
		expect(epic_decide.decide).toHaveBeenCalledWith(
			expect.objectContaining({ decision: expect.stringContaining(`parent action done: ${DONE}`) }),
		)
	})

	it('refuses --done on an option needing no parent action before any write', async () => {
		await expect(
			backlog_triage_cli.run([...adopt_argv('1'), '--done', DONE], DIRECTORY),
		).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('needs no parent action'))
	})
})

describe('backlog:triage --apply --adopt — arguments', () => {
	it.each([
		['no reason', ['--apply', ISSUE, '--adopt', '1']],
		['an option that is no number', ['--apply', ISSUE, '--adopt', 'one', '--reason', REASON]],
		['a run label beside it', [...adopt_argv('1'), '--lane']],
	])('prints the usage for %s', async (_case, argv) => {
		await expect(backlog_triage_cli.run(argv, DIRECTORY)).resolves.toBe(1)

		expect(order).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('[--done <the parent action taken>]'),
		)
	})
})
