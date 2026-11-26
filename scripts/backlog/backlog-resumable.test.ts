import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_stash } from '#scripts/git/stash/git-stash'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_resume_wait } from '#scripts/run/event/run-resume-wait'
import { beforeEach, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_resumable } from './backlog-resumable'
import { backlog_resume_reads } from './backlog-resume-reads'

const ISSUE = 901
const PAUSED = 902
const OPEN_PR = 903
const IDLE = 904
const BLOCKED = 905
const BLOCKER = 906
const STASH_ERROR = 'git failed'
const AT = '2026-11-23T06:32:50Z'
const { EVENT_KIND } = run_event_stream

function child(number: number, repo: string = backlog_fixture.REPO): EpicChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [] }
}

function result(): EpicNextResult {
	return {
		verdict: 'run',
		candidates: [{ repo: backlog_fixture.REPO, children: [child(PAUSED), child(OPEN_PR)] }],
		waiting: [child(ISSUE), child(ISSUE, 'someone/other'), child(IDLE)],
		blocked_on_people: [],
		anomalies: [],
	}
}

function flags(enriched: EpicNextResult): Array<boolean | undefined> {
	return [...enriched.candidates.flatMap((bundle) => bundle.children), ...enriched.waiting].map(
		(row) => row.is_resumable,
	)
}

function outage(...issues: ReadonlyArray<number>): void {
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue(
		issues.map((issue, pos) => ({
			pos,
			at: AT,
			kind: EVENT_KIND.OUTAGE,
			text: `#${String(issue)} outage`,
		})),
	)
}

function recorded(): Array<string> {
	return vi.mocked(run_event_stream_emit.emit).mock.calls.map(([, text]) => text)
}

beforeEach(() => {
	vi.restoreAllMocks()
	backlog_fixture.stub_backlog({ stashed: [ISSUE], paused: [PAUSED], open_pr: [OPEN_PR] })
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([])
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
})

it('marks a child an outage stopped resumable and records why it waits', async () => {
	outage(IDLE, BLOCKED)
	const blocked = {
		...child(BLOCKED),
		blocked_by: [{ number: BLOCKER, repo: backlog_fixture.REPO }],
	}

	const enriched = await backlog_resumable.read(
		{ ...result(), waiting: [child(IDLE), blocked] },
		backlog_fixture.REPO,
	)

	expect(enriched.waiting.map((row) => row.is_resumable)).toEqual([true, true])
	expect(recorded()).toEqual([
		`#${String(IDLE)} ${run_resume_wait.SEAT_WAIT}`,
		`#${String(BLOCKED)} ${run_resume_wait.BLOCKER_WAIT} #${String(BLOCKER)}`,
	])
})

it('records a seat wait for an outage candidate and nothing for a child no outage stopped', async () => {
	outage(PAUSED)

	await backlog_resumable.read(result(), backlog_fixture.REPO)

	expect(recorded()).toEqual([`#${String(PAUSED)} ${run_resume_wait.SEAT_WAIT}`])
})

it('marks stashed, paused and open-PR children resumable without reading foreign issues', async () => {
	const enriched = await backlog_resumable.read(result(), backlog_fixture.REPO)

	expect(flags(enriched)).toEqual([true, true, true, undefined, false])
	expect(git_stash.list).toHaveBeenCalledTimes(1)
})

it('reads each signal once for the scan, asking the pause read only of unstashed children', async () => {
	await backlog_resumable.read(result(), backlog_fixture.REPO)

	expect(backlog_resume_reads.paused_issues).toHaveBeenCalledExactlyOnceWith(
		[String(PAUSED), String(OPEN_PR), String(IDLE)],
		backlog_fixture.REPO,
	)
	expect(backlog_resume_reads.open_pr_issues).toHaveBeenCalledExactlyOnceWith(backlog_fixture.REPO)
})

it('reads no signal when every local child is stashed', async () => {
	backlog_fixture.stub_backlog({ stashed: [ISSUE, PAUSED, OPEN_PR, IDLE] })

	const enriched = await backlog_resumable.read(result(), backlog_fixture.REPO)

	expect(flags(enriched)).toEqual([true, true, true, undefined, true])
	expect(backlog_resume_reads.paused_issues).not.toHaveBeenCalled()
	expect(backlog_resume_reads.open_pr_issues).not.toHaveBeenCalled()
})

it('refuses an unreadable stash list instead of treating it as empty', async () => {
	vi.mocked(git_stash.list).mockRejectedValue(new Error(STASH_ERROR))

	await expect(backlog_resumable.read(result(), backlog_fixture.REPO)).rejects.toThrow(STASH_ERROR)
})

it.each(['pause', 'PR'])('propagates an unreadable %s signal', async (signal) => {
	const reader =
		signal === 'pause' ? backlog_resume_reads.paused_issues : backlog_resume_reads.open_pr_issues

	vi.mocked(reader).mockRejectedValue(new Error(STASH_ERROR))

	await expect(backlog_resumable.read(result(), backlog_fixture.REPO)).rejects.toThrow(STASH_ERROR)
})
