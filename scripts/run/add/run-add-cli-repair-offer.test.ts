import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { backlog_fixture } from '#scripts/backlog/backlog-fixture'
import { backlog_next } from '#scripts/backlog/backlog-next'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import {
	AUTO_OK_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	RUN_LANE_LABEL,
} from '#scripts/issue/issue-labels'
import { lane_await } from '#scripts/lane/lane-await'
import { run_cut_cli } from '#scripts/run/cut/run-cut-cli'
import { run_cut_cli_fixture } from '#scripts/run/cut/run-cut-cli-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { AddPorts } from './run-add'
import { run_add_cli } from './run-add-cli'
import { run_add_cli_repair_fixture } from './run-add-cli-repair-fixture'

const { ISSUE } = run_cut_cli_fixture

run_add_cli_repair_fixture.install(run_cut_cli.run)

// The labels a merge wait leaves behind: the park, and the ended lane's `in-progress`.
function waiting_store(): { ports: AddPorts; labels: Set<string> } {
	const labels = new Set([
		AUTO_OK_LABEL,
		RUN_LANE_LABEL,
		NEEDS_HUMAN_MERGE_LABEL,
		IN_PROGRESS_LABEL,
	])
	const ports: AddPorts = {
		read_issue: async () => ({ is_open: true, labels: [...labels], blockers: [] }),
		apply_label: async (_issue, label) => Boolean(labels.add(label)),
		clear_label: async (_issue, label) => labels.delete(label) || true,
	}

	return { ports, labels }
}

// The issue the backlog selection offers next, read off its printed answer.
async function offered(labels: ReadonlySet<string>): Promise<string | undefined> {
	backlog_fixture.stub_backlog({
		opted_in: [auto_ok_fixture.issue(Number(ISSUE), CREATED_EARLIER, [...labels])],
	})
	vi.mocked(console.info).mockClear()
	await backlog_next.run([])

	return vi.mocked(console.info).mock.calls.flat().map(String).at(-1)
}

// joshuafolkken/kit#7487: a recorded repair on a merge wait is offered, not excluded as a person's.
describe('repair of a pull request waiting on a person merge', () => {
	it('dispatches the repair on the next offer despite the ended lane in-progress', async () => {
		const store = waiting_store()

		expect(await run_add_cli.run([ISSUE, '--retry'], store.ports)).toBe(0)
		expect(store.labels.has(NEEDS_HUMAN_MERGE_LABEL)).toBe(false)
		expect(store.labels.has(IN_PROGRESS_LABEL)).toBe(false)
		expect(await offered(store.labels)).toBe(ISSUE)
	})

	it('keeps the merge wait without a repair boundary', async () => {
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'MERGED' }))
		const store = waiting_store()

		await run_add_cli.run([ISSUE, '--retry'], store.ports)
		expect(store.labels.has(NEEDS_HUMAN_MERGE_LABEL)).toBe(true)
		expect(await offered(store.labels)).not.toBe(ISSUE)
	})
})

// joshuafolkken/kit#7493: a lane still holding work keeps its in-progress and stays unoffered.
describe('repair of a lane still holding work', () => {
	it.each([
		['a live owner', () => vi.mocked(lane_await.other_process_trace).mockResolvedValue('alive')],
		['an uncommitted lane tree', () => vi.mocked(git_command.status).mockResolvedValue(' M a.ts')],
		[
			'an unreadable lane tree',
			() => vi.mocked(git_command.status).mockRejectedValue(new Error('git')),
		],
	])('keeps in-progress with %s', async (_case, arrange) => {
		arrange()
		const store = waiting_store()

		await run_add_cli.run([ISSUE, '--retry'], store.ports)
		expect(store.labels.has(IN_PROGRESS_LABEL)).toBe(true)
		expect(await offered(store.labels)).not.toBe(ISSUE)
	})
})
