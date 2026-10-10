import type { josh_command } from '#scripts/josh/josh-run'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { run_ship_scoped as real_scoped } from './run-ship-scoped'

const josh_run_mock = vi.hoisted(() => vi.fn<typeof josh_command.josh_run>())
const review_mock = vi.hoisted(() => vi.fn())
const round_two_mock = vi.hoisted(() => vi.fn())
const repository_mock = vi.hoisted(() => vi.fn())
const preflight_mock = vi.hoisted(() => vi.fn())
const scoped_mock = vi.hoisted(() => vi.fn<typeof real_scoped.scoped_pair>())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
// A fresh ship: nothing recorded and nothing committed, pushed or merged. The resume paths are pinned in
// `run-ship-resume.test.ts`.
vi.mock('./run-ship-probe', () => ({
	run_ship_probe: {
		read_state: vi.fn().mockResolvedValue({
			is_committed: false,
			is_pushed: false,
			is_merged: false,
		}),
		record_target: vi.fn().mockResolvedValue(undefined),
		repository_directory: repository_mock,
	},
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn() },
}))
vi.mock('./run-ship-review-steps', () => ({
	run_ship_review_steps: { review_stage: review_mock, round_two_stage: round_two_mock },
}))
vi.mock('./run-ship-preflight', () => ({ run_ship_preflight: { stage: preflight_mock } }))
vi.mock('./run-ship-scoped', async (import_original) => {
	const actual = await import_original<{ run_ship_scoped: typeof real_scoped }>()

	// The real `scoped_gate` calls its own module's pair, so it is rebuilt around the mocked one.
	async function scoped_gate(): ReturnType<typeof real_scoped.scoped_gate> {
		return await actual.run_ship_scoped.run_phases([
			scoped_mock,
			async () => await josh_run_mock(['gate'], true),
		])
	}

	return { run_ship_scoped: { ...actual.run_ship_scoped, scoped_gate, scoped_pair: scoped_mock } }
})
// The sync stage's merge of the default branch is pinned in `run-ship-sync.test.ts`; here it is
// current, so no test ever merges into the checkout it runs in.
vi.mock('#scripts/git/main-merge', () => ({
	main_merge: { merge: vi.fn().mockResolvedValue({ kind: 'current', branch: 'main' }) },
}))
vi.mock('#scripts/gh/git-gh-pr-read', () => ({
	git_gh_pr_read: { pr_get_merge_state: vi.fn().mockResolvedValue(undefined) },
}))
// Outside a lane, so a gate run inside a lane child never hands these ships to a real supervisor.
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: vi.fn().mockReturnValue(false) },
}))

const { lane_ledger } = await import('#scripts/lane/lane-ledger')
const { run_ship_cli } = await import('./run-ship-cli')
const { run_ship_detach } = await import('./run-ship-detach')

const OK = 0
const FAILED = 1
const TITLE = 'Fold the ship region #2398'
const NUMBER = '2398'

const NOTIFY_FLAG = '--notify-message'
const NOTIFY = 'done: cause/fix/result'
const NOTIFY_FILE_FLAG = '--notify-message-file'
const BODY_PATH = 'notify-body.txt'
const GATE = ['gate']
const COMMIT = ['git', '-y', TITLE]
const FOLLOWUP = ['followup', TITLE]
const REPORT = ['run:tail', NUMBER]
const BODY_FILE_FLAG = '--body-file'
const PREFLIGHT_SECTION = '=== preflight ===\nready\n\n'
const SYNC_SECTION = '=== sync origin/main ===\nmain brings nothing in\n\n'

const info_lines: Array<string> = []

function argv_calls(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0])
}

beforeEach(() => {
	// Outside a supervisor, so a gate the detached supervisor runs never reads these ships as supervised.
	vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '')
	repository_mock.mockReset().mockResolvedValue(process.cwd())
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	review_mock.mockReset().mockResolvedValue({ code: OK, out: 'review clean' })
	round_two_mock.mockReset().mockResolvedValue({ code: OK, out: 'round 2 not due' })
	preflight_mock.mockReset().mockResolvedValue({ code: OK, out: 'ready' })
	scoped_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_ship_cli.run — supervised completion', () => {
	it.each([OK, FAILED])('records the supervisor result for exit code %s', async (code) => {
		vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '1')
		josh_run_mock.mockResolvedValueOnce({ code, out: 'gate result' })
		const mark = vi.spyOn(run_ship_detach, 'mark_result').mockResolvedValue(undefined)
		const claim = vi.spyOn(run_ship_detach, 'claim_identity').mockResolvedValue(undefined)

		expect(await run_ship_cli.run([TITLE])).toBe(code)
		expect(mark).toHaveBeenCalledWith(process.cwd(), NUMBER, code)
		mark.mockRestore()
		claim.mockRestore()
	})

	// joshuafolkken/kit#2642: the supervisor names itself before any stage, so a launcher that could not
	// read its start time never leaves a bare pid to be believed.
	it('claims the supervisor identity before the first stage runs', async () => {
		vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '1')
		const calls: Array<string> = []
		const claim = vi.spyOn(run_ship_detach, 'claim_identity').mockImplementation(async () => {
			calls.push('claim')
		})
		const mark = vi.spyOn(run_ship_detach, 'mark_result').mockResolvedValue(undefined)

		josh_run_mock.mockImplementation(async () => {
			calls.push('stage')

			return { code: OK, out: '' }
		})
		await run_ship_cli.run([TITLE])

		expect(claim).toHaveBeenCalledWith(process.cwd(), NUMBER)
		expect(calls[0]).toBe('claim')
		claim.mockRestore()
		mark.mockRestore()
	})

	it('claims nothing outside a supervisor', async () => {
		const claim = vi.spyOn(run_ship_detach, 'claim_identity')

		await run_ship_cli.run([TITLE])

		expect(claim).not.toHaveBeenCalled()
		claim.mockRestore()
	})
})

describe('run_ship_cli.run — folds the four ship steps into one call', () => {
	it('runs gate, commit, followup and report in order', async () => {
		const code = await run_ship_cli.run([TITLE])

		expect(code).toBe(OK)
		expect(argv_calls()).toStrictEqual([GATE, COMMIT, FOLLOWUP, REPORT])
	})

	it('reads the issue number off the title tail for the report step', async () => {
		await run_ship_cli.run(['Some other #17 mid-title work #2398'])

		expect(argv_calls().at(-1)).toStrictEqual(['run:tail', '2398'])
	})

	it('forwards follow-up citations filed this run to the report step', async () => {
		await run_ship_cli.run([TITLE, '2400', '2401'])

		expect(argv_calls().at(-1)).toStrictEqual(['run:tail', NUMBER, '2400', '2401'])
	})

	it('joins each executed step under its header in one composite report', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'green' })
			.mockResolvedValueOnce({ code: OK, out: 'pushed' })
			.mockResolvedValueOnce({ code: OK, out: 'merged' })
			.mockResolvedValueOnce({ code: OK, out: 'shipped' })

		await run_ship_cli.run([TITLE])

		expect(info_lines[0]).toBe(
			`${PREFLIGHT_SECTION}${SYNC_SECTION}=== gate ===\ngreen\n\n=== commit/push/PR ===\npushed\n\n=== followup ===\nmerged\n\n=== report ===\nshipped`,
		)
	})
})

// joshuafolkken/kit#2946: the stops a pull-request precondition or a scoped check not yet run caused landed
// after the review and the gate; the preflight stage asks them first.
describe('run_ship_cli.run — the preflight runs before the review and the gate', () => {
	it('stops at an unmet pull-request precondition before the review or the gate starts', async () => {
		preflight_mock.mockResolvedValue({ code: FAILED, out: 'release classification missing' })

		expect(await run_ship_cli.run([TITLE, '--review'])).toBe(FAILED)
		expect(review_mock).not.toHaveBeenCalled()
		expect(argv_calls()).toStrictEqual([])
		expect(info_lines[0]).toBe(
			'=== preflight ===\nrelease classification missing\n\nstopped at: === preflight ===',
		)
	})

	it('hands the preflight the title and the --body-file path', async () => {
		await run_ship_cli.run([TITLE, BODY_FILE_FLAG, BODY_PATH])

		expect(preflight_mock).toHaveBeenCalledWith({ title: TITLE, body_path: BODY_PATH })
	})

	it('meets the scoped pair in front of the gate, then runs the gate', async () => {
		const calls: Array<string> = []

		scoped_mock.mockImplementation(async () => {
			calls.push('scoped')

			return { code: OK, out: '' }
		})
		josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
			calls.push(argv.join(' '))

			return { code: OK, out: '' }
		})
		await run_ship_cli.run([TITLE])

		expect(calls.slice(0, 2)).toStrictEqual(['scoped', 'gate'])
	})

	it('never reaches the gate when the scoped pair is red', async () => {
		scoped_mock.mockResolvedValue({ code: FAILED, out: 'lint:related red' })

		expect(await run_ship_cli.run([TITLE])).toBe(FAILED)
		expect(argv_calls()).toStrictEqual([])
	})
})

describe('run_ship_cli.run — forwards the notify body to followup alone', () => {
	it('forwards an inline notify message', async () => {
		await run_ship_cli.run([TITLE, NOTIFY_FLAG, NOTIFY])

		expect(argv_calls()).toStrictEqual([
			GATE,
			COMMIT,
			['followup', TITLE, NOTIFY_FLAG, NOTIFY],
			REPORT,
		])
	})

	it('forwards the shell-body-safe file form', async () => {
		await run_ship_cli.run([TITLE, NOTIFY_FILE_FLAG, BODY_PATH])

		expect(argv_calls().at(-2)).toStrictEqual(['followup', TITLE, NOTIFY_FILE_FLAG, BODY_PATH])
	})
})

// joshuafolkken/kit#2446: the PR body carries the live-execution evidence `followup` gates on.
describe('run_ship_cli.run — forwards the PR body file to the commit step alone', () => {
	it('passes --body-file to git -y and not to followup', async () => {
		await run_ship_cli.run([TITLE, BODY_FILE_FLAG, BODY_PATH])

		expect(argv_calls()).toStrictEqual([
			GATE,
			['git', '-y', BODY_FILE_FLAG, BODY_PATH, TITLE],
			['followup', TITLE],
			REPORT,
		])
	})
})

describe('run_ship_cli.run — a failed step stops the ship', () => {
	it('does not run the commit when the gate failed, and exits non-zero', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		const code = await run_ship_cli.run([TITLE])

		expect(code).toBe(FAILED)
		expect(argv_calls()).toStrictEqual([GATE])
	})

	it('names the stopped step in the report', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'lint red' })

		await run_ship_cli.run([TITLE])

		expect(info_lines[0]).toBe(
			`${PREFLIGHT_SECTION}${SYNC_SECTION}=== gate ===\nlint red\n\nstopped at: === gate ===`,
		)
	})

	it('refuses a title with no issue number rather than shipping past run:tail', async () => {
		expect(await run_ship_cli.run(['A title with no reference'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})

	it('refuses a non-numeric follow-up citation rather than forwarding it', async () => {
		expect(await run_ship_cli.run([TITLE, 'not-a-number'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})

	it('refuses a stray flag rather than forwarding it to a step', async () => {
		expect(await run_ship_cli.run(['--force'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_cli.run — --review owns the round-1 review (joshuafolkken/kit#2427)', () => {
	it('reviews before the gate, then ships the clean path without an agent turn', async () => {
		expect(await run_ship_cli.run([TITLE, '--review'])).toBe(OK)
		expect(review_mock).toHaveBeenCalledWith(NUMBER)
		expect(argv_calls()).toStrictEqual([GATE, COMMIT, FOLLOWUP, REPORT])
		expect(info_lines[0]).toMatch(
			/^=== preflight ===\nready\n\n=== review ===\nreview clean\n\n=== sync origin\/main ===\nmain brings nothing in\n\n=== gate ===/u,
		)
	})

	it('stops at a blocking review, never reaching the gate or the commit', async () => {
		review_mock.mockResolvedValue({ code: FAILED, out: 'bug-risks:high:a.ts' })

		expect(await run_ship_cli.run([TITLE, '--review'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(info_lines[0]).toContain('stopped at: === review ===')
	})

	it('runs no review without the flag', async () => {
		await run_ship_cli.run([TITLE])

		expect(review_mock).not.toHaveBeenCalled()
		expect(round_two_mock).not.toHaveBeenCalled()
	})
})

// Every stage the ship runs, in the order it ran them — the two review stages and each josh command.
function order(): ReadonlyArray<string> {
	const events: Array<string> = []

	review_mock.mockImplementation(async () => {
		events.push('review')

		return { code: OK, out: 'review fixes applied in place' }
	})
	round_two_mock.mockImplementation(async () => {
		events.push('round-2')

		return { code: OK, out: 'round 2 clean' }
	})
	josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
		events.push(argv[0] ?? '')

		return { code: OK, out: '' }
	})

	return events
}

// joshuafolkken/kit#2489: round 1 fixed its local Mediums in place, so the supervisor carries the ship
// through the gate, the commit, a round-2 pass and the followup without handing it back.
describe('run_ship_cli.run — --review carries round 2 between the commit and the followup', () => {
	it('runs review → gate → commit → round 2 → followup → report without stopping', async () => {
		const events = order()

		expect(await run_ship_cli.run([TITLE, '--review'])).toBe(OK)
		expect(events).toStrictEqual(['review', 'gate', 'git', 'round-2', 'followup', 'run:tail'])
		expect(round_two_mock).toHaveBeenCalledWith(NUMBER)
	})

	it('stops at a blocking round 2, never reaching the followup', async () => {
		round_two_mock.mockResolvedValue({ code: FAILED, out: 'round 2 is final' })

		expect(await run_ship_cli.run([TITLE, '--review'])).toBe(FAILED)
		expect(argv_calls()).toStrictEqual([GATE, COMMIT])
		expect(info_lines[0]).toContain('stopped at: === round-2 review ===')
	})
})

// joshuafolkken/kit#3643: every stage that ran leaves its duration in the lane ledger, so
// `lane:stats` can say where a lane's time went — the stage that stopped the ship included.
it('records each stage a ship ran, never a skipped one, up to the one that failed', async () => {
	const record = vi.spyOn(lane_ledger, 'record_stage').mockResolvedValue()

	review_mock.mockResolvedValue({ code: OK, out: 'round 1 already recorded', is_skipped: true })
	josh_run_mock.mockResolvedValueOnce({ code: FAILED, out: 'gate red' })
	await run_ship_cli.run([TITLE, '--review'])

	expect(
		record.mock.calls.map(([stage]) => `${stage.stage} #${String(stage.issue)}`),
	).toStrictEqual(['preflight', 'sync', 'gate'].map((stage) => `${stage} #${NUMBER}`))
})
