import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_stage } from './run-ship-stage'
import { run_ship_waiter } from './run-ship-waiter'

// `josh ship:wait <N>` — the lane session that detached a ship waits here for the gate and review
// round 1, so a stop there comes back to it (`run-ship-waiter.ts`) rather than to a fresh session
// (joshuafolkken/kit#4711). One verdict line, then the stop note on `returned`:
//
// - `returned` — the supervisor stopped and handed its note to this session: fix it and ship again.
// - `passed` — the ship committed, or finished: what follows is the supervisor's alone.
// - `ended` — the supervisor ended with no note for this session: nothing is left to wait for.
// - `pending` — the chunk ran out with the ship still before its commit: issue the wait again.
//
// **A chunk ends below the five-minute prompt-cache TTL a lane child runs on** (`lane-child-marker.ts`),
// so re-issuing it is the keep-alive: the next request reads the cached context back (66k tokens on
// Opus 5.5, about $0.013) instead of writing it whole again after the wait (about $0.33) —
// joshuafolkken/kit#5344. The heartbeat outlives the chunk by the session gap.

const VERDICT = {
	RETURNED: 'returned',
	PASSED: 'passed',
	ENDED: 'ended',
	PENDING: 'pending',
} as const

type Verdict = (typeof VERDICT)[keyof typeof VERDICT]

interface Waited {
	verdict: Verdict
	note?: string
}

const CHUNK_MS = 270_000
const POLL_MS = 2000
const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh ship:wait <N>'
const NO_REPOSITORY_NOTE = 'not inside a git repository'

const { COMMIT, ROUND_TWO, FOLLOWUP, REPORT } = run_ship_stage.STAGE
const PAST_COMMIT: ReadonlySet<string> = new Set([ROUND_TWO, FOLLOWUP, REPORT])

// Past the commit in the current attempt: the record's `done` outlives a stop after the commit, so a
// re-ship after a followup stop would read as committed before its own gate and review ran. `started`
// is cleared at every stop, so it says what this attempt reached.
function is_committed(repository: string, issue: string): boolean {
	const target = run_ship_stage.record_path(repository, issue)
	const started = run_ship_stage.read_started(target)

	if (started.some((stage) => PAST_COMMIT.has(stage))) return true

	return started.includes(COMMIT) && run_ship_stage.read_done(target).has(COMMIT)
}

// The supervisor's own end, where it left no note: `undefined` while it still runs.
function ended(repository: string, issue: string): Waited | undefined {
	const result = run_ship_detach.read_result(repository, issue)?.result

	if (result === 'running') return undefined

	return { verdict: result === 'success' ? VERDICT.PASSED : VERDICT.ENDED }
}

function settled(repository: string, issue: string): Waited | undefined {
	const note = run_ship_waiter.take(repository, issue)

	if (note !== undefined) return { verdict: VERDICT.RETURNED, note }
	if (is_committed(repository, issue)) return { verdict: VERDICT.PASSED }

	return ended(repository, issue)
}

async function poll(repository: string, issue: string, deadline: number): Promise<Waited> {
	while (Date.now() < deadline) {
		run_ship_waiter.beat(repository, issue)
		const waited = settled(repository, issue)

		if (waited !== undefined) return waited

		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the supervisor's progress
		await sleep(POLL_MS)
	}

	return { verdict: VERDICT.PENDING }
}

// A `pending` chunk keeps the heartbeat for the next one; any other verdict ends the wait for good.
async function wait_for(repository: string, issue: string, chunk_ms = CHUNK_MS): Promise<Waited> {
	const waited = await poll(repository, issue, Date.now() + chunk_ms)

	if (waited.verdict !== VERDICT.PENDING) run_ship_waiter.leave(repository, issue)

	return waited
}

// Each verdict carries what the session does next, so the instruction lives with the command.
function next_action(issue: string): Record<Verdict, string> {
	return {
		[VERDICT.RETURNED]: 'the ship stopped: fix what the note below says, then ship again',
		[VERDICT.PASSED]: 'the supervisor ships the rest: end the turn',
		[VERDICT.ENDED]: 'nothing is left to wait for: end the turn',
		[VERDICT.PENDING]: `still before the commit: on \`pnpm josh cost --cut\` \`under\`, run \`pnpm josh ship:wait ${issue}\` again; else end the turn`,
	}
}

function report(issue: string, waited: Waited): void {
	console.info(`${waited.verdict} — ${next_action(issue)[waited.verdict]}`)
	if (waited.note !== undefined) console.info(waited.note)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue = issue_number_shape.single_of(argv)

	if (issue === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const repository = await run_ship_probe.repository_directory()

	if (repository === undefined) {
		console.error(NO_REPOSITORY_NOTE)

		return FAILURE_EXIT_CODE
	}

	report(issue, await wait_for(repository, issue))

	return SUCCESS_EXIT_CODE
}

const run_ship_wait_cli = { CHUNK_MS, VERDICT, run, wait_for }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export { run_ship_wait_cli }
