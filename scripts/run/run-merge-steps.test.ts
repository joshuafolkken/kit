import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { git_stash } from '#scripts/git/git-stash'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { run_carry } from './run-carry'
import { run_cut } from './run-cut'

const add_label_mock = vi.hoisted(() => vi.fn())
const remove_label_mock = vi.hoisted(() => vi.fn())
const comment_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: add_label_mock,
		issue_remove_label: remove_label_mock,
		issue_try_comment: comment_mock,
	},
}))

const reap_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lane/lane-reap', () => ({
	lane_reap: { reap_child: reap_mock },
}))

const { run_merge_steps } = await import('./run-merge-steps')

const CONTEXT = {
	child: '2070',
	epic: undefined,
	repo: undefined,
	over: CONTEXT_CUT_THRESHOLD,
	owner: run_carry.NO_OWNER,
}

// A carry record whose budget has been handed off to a successor (joshuafolkken/kit#2114).
const HANDED_OFF_CARRY = {
	invocation: 'backlogrun #1 #2',
	started_at: new Date().toISOString(),
	merged: 0,
	filed: 0,
	cuts: 1,
	failures: 0,
	outages: 0,
	is_handed_off: true as const,
}

beforeEach(() => {
	add_label_mock.mockReset()
	remove_label_mock.mockReset().mockResolvedValue(undefined)
	reap_mock.mockReset().mockReturnValue([])
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
})

// joshuafolkken/kit#2421: the branches that judge a child finished are where its lingering process is
// ended — a hung child left running answers the pgrep liveness check `alive` for its number forever.
describe('run_merge_steps — ending the child process where the child is judged finished', () => {
	it('do_failed terminates the abandoned child', async () => {
		await run_merge_steps.do_failed(CONTEXT)

		expect(reap_mock).toHaveBeenCalledWith(CONTEXT.child)
	})

	it('do_outage terminates the old child before the re-dispatch launches another', async () => {
		await run_merge_steps.do_outage(CONTEXT)

		expect(reap_mock).toHaveBeenCalledWith(CONTEXT.child)
	})

	it('touches no process when the carry record refused the count', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: HANDED_OFF_CARRY })

		await run_merge_steps.do_failed(CONTEXT)

		expect(reap_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_steps.do_failed — parking is part of the result', () => {
	it('reports a failed needs-decision label write instead of treating the child as parked', async () => {
		add_label_mock.mockResolvedValue(false)

		expect(await run_merge_steps.do_failed(CONTEXT)).toStrictEqual({
			carry: undefined,
			is_parked: false,
			is_refused: false,
		})
	})
})

// joshuafolkken/kit#2240: an API-outage child is left re-dispatchable — its `in-progress` is dropped so
// the next offer can hand it back, but it is never parked with `needs-decision`.
describe('run_merge_steps.do_outage — re-dispatchable, never parked', () => {
	it('drops in-progress but does not add needs-decision', async () => {
		await run_merge_steps.do_outage(CONTEXT)

		expect(remove_label_mock).toHaveBeenCalledTimes(1)
		expect(add_label_mock).not.toHaveBeenCalled()
	})

	it('returns is_refused and skips label writes when the record is handed off', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: HANDED_OFF_CARRY })

		const result = await run_merge_steps.do_outage(CONTEXT)

		expect(result.is_refused).toBe(true)
		expect(remove_label_mock).not.toHaveBeenCalled()
		expect(add_label_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_steps — carry owner check (joshuafolkken/kit#2114)', () => {
	beforeEach(() => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: HANDED_OFF_CARRY })
	})

	it('do_merged: returns the carry and skips git ops when the record is handed off', async () => {
		const result = await run_merge_steps.do_merged(CONTEXT)

		expect(result).toStrictEqual(HANDED_OFF_CARRY)
	})

	it('do_failed: returns is_refused and skips label writes when the record is handed off', async () => {
		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.is_refused).toBe(true)
		expect(add_label_mock).not.toHaveBeenCalled()
		expect(remove_label_mock).not.toHaveBeenCalled()
	})

	it('refused_carry: returns the handed-off record, and nothing when there is no record', async () => {
		expect(await run_merge_steps.refused_carry(CONTEXT)).toStrictEqual(HANDED_OFF_CARRY)

		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)

		expect(await run_merge_steps.refused_carry(CONTEXT)).toBeUndefined()
	})

	it('do_merged: refuses an expired record whose budget was handed off', async () => {
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'expired', carry: HANDED_OFF_CARRY })

		expect(await run_merge_steps.do_merged(CONTEXT)).toStrictEqual(HANDED_OFF_CARRY)
	})
})

// joshuafolkken/kit#2476: the merged path removed a lane by force while it still held work the child had
// popped back from a park, so the close now stashes that work first.
// A real directory with a `.git` entry, so the merged path reads it as a work tree.
const LANE_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'lane-'))

mkdirSync(path.join(LANE_DIRECTORY, '.git'))
const LANE_CLOSE_MESSAGE = `${CONTEXT.child}: uncommitted work at lane close`

interface LaneCloseSpies {
	josh_run: MockInstance<typeof josh_command.josh_run>
	push: MockInstance<typeof git_stash.push>
}

// The merged path's side effects stubbed at their seams: the `josh` subprocesses (`main:sync`,
// `lane:close`), the stash push, and the lane directory the close would remove.
function stub_lane_close(): LaneCloseSpies {
	comment_mock.mockReset().mockResolvedValue(true)
	vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
		existing: undefined,
		targets: { directory: LANE_DIRECTORY, branch: `${CONTEXT.child}-lane` },
	})

	return {
		josh_run: vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' }),
		push: vi.spyOn(git_stash, 'push').mockResolvedValue(),
	}
}

function did_close(spies: LaneCloseSpies): boolean {
	return spies.josh_run.mock.calls.some(([args]) => args[0] === 'lane:close')
}

describe('run_merge_steps.do_merged — uncommitted work at lane close', () => {
	const MESSAGE = LANE_CLOSE_MESSAGE
	let spies: LaneCloseSpies

	beforeEach(() => {
		spies = stub_lane_close()
	})

	it('stashes the work, records it on the issue, then closes the lane', async () => {
		vi.spyOn(git_stash, 'has_changes').mockResolvedValue(true)

		await run_merge_steps.do_merged(CONTEXT)

		expect(spies.push).toHaveBeenCalledWith(MESSAGE, LANE_DIRECTORY)
		expect(comment_mock).toHaveBeenCalledWith(CONTEXT.child, expect.stringContaining(MESSAGE))
		expect(did_close(spies)).toBe(true)
	})

	it('closes a clean lane as before, with nothing stashed', async () => {
		vi.spyOn(git_stash, 'has_changes').mockResolvedValue(false)

		await run_merge_steps.do_merged(CONTEXT)

		expect(spies.push).not.toHaveBeenCalled()
		expect(comment_mock).not.toHaveBeenCalled()
		expect(did_close(spies)).toBe(true)
	})

	it('leaves the lane on disk when the stash push fails', async () => {
		vi.spyOn(git_stash, 'has_changes').mockResolvedValue(true)
		spies.push.mockRejectedValue(new Error('stash failed'))
		vi.spyOn(console, 'error').mockReturnValue()

		await run_merge_steps.do_merged(CONTEXT)

		expect(did_close(spies)).toBe(false)
	})
})

describe('run_merge_steps.do_merged — a lane directory that is no work tree', () => {
	it('closes the remnant of an interrupted close without reading its status', async () => {
		const spies = stub_lane_close()
		const status_read = vi.spyOn(git_stash, 'has_changes')

		vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
			existing: undefined,
			targets: { directory: tmpdir(), branch: `${CONTEXT.child}-lane` },
		})

		await run_merge_steps.do_merged(CONTEXT)

		expect(status_read).not.toHaveBeenCalled()
		expect(did_close(spies)).toBe(true)
	})
})

const CUT_LANE = {
	issue: CONTEXT.child,
	branch: `${CONTEXT.child}-lane`,
	directory: '/lanes/2070',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}
const LANE_CUT = run_cut.fresh_cut(
	{
		issue: CONTEXT.child,
		branch: CUT_LANE.branch,
		phase: run_cut.IMPLEMENTATION_PHASE,
		handoff: { instruction: 'go', completed: [], remaining: [], untouched: [] },
	},
	new Date(),
)
const CUT_TARGET = '/stub/cut.json'
const OPENAI_LANE: LaneInfo = {
	...CUT_LANE,
	profile: { provider: 'openai', role: 'worker', model: 'gpt-5', effort: 'medium' },
}

// joshuafolkken/kit#2484: the fallback relaunch of a cut no successor adopted — through the same
// `lane_relaunch` the cut uses, once per cut, and never for an OpenAI lane whose supervisor owns it.
describe('run_merge_steps.resume_cut — the fallback relaunch', () => {
	let relaunch: MockInstance<typeof lane_relaunch.resume>
	let mark: MockInstance<typeof run_cut.mark_merge_relaunched>

	beforeEach(() => {
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(CUT_LANE)
		vi.spyOn(run_cut, 'lane_cut_sync').mockReturnValue({ target: CUT_TARGET, cut: LANE_CUT })
		mark = vi.spyOn(run_cut, 'mark_merge_relaunched').mockReturnValue(true)
		relaunch = vi.spyOn(lane_relaunch, 'resume').mockReturnValue({ kind: 'launched', pid: 1 })
	})

	it('reads an unadopted cut as resumable and relaunches it at its phase', async () => {
		expect(await run_merge_steps.has_resumable_cut(CONTEXT.child)).toBe(true)
		expect(await run_merge_steps.resume_cut(CONTEXT.child)).toBe(true)
		expect(mark).toHaveBeenCalledOnce()
		expect(relaunch.mock.calls[0]?.[1]).toBe(run_cut.IMPLEMENTATION_PHASE)
	})

	it('does not relaunch a cut the fallback already relaunched once', async () => {
		vi.spyOn(run_cut, 'lane_cut_sync').mockReturnValue({
			target: CUT_TARGET,
			cut: { ...LANE_CUT, is_merge_relaunched: true },
		})

		expect(await run_merge_steps.has_resumable_cut(CONTEXT.child)).toBe(false)
		expect(await run_merge_steps.resume_cut(CONTEXT.child)).toBe(false)
		expect(relaunch).not.toHaveBeenCalled()
	})

	it('leaves an OpenAI lane to its supervisor', async () => {
		vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(OPENAI_LANE)

		expect(await run_merge_steps.has_resumable_cut(CONTEXT.child)).toBe(false)
	})

	it('reports a relaunch that could not start', async () => {
		relaunch.mockReturnValue({ kind: 'failed', note: 'no binary' })

		expect(await run_merge_steps.resume_cut(CONTEXT.child)).toBe(false)
	})
})
