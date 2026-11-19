import { execFileSync, spawn } from 'node:child_process'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { issue_read } from '#scripts/issue/issue-read'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import { process_identity } from '#scripts/josh/process-identity'
import { lane_child_mark_keys } from '#scripts/lane/lane-child-mark-keys'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry_session } from '#scripts/run/carry/run-carry-session'
import { run_observe_state, type ObserveRecord } from './run-observe-state'

// joshuafolkken/kit#8128: a lane child observes a process at times hours apart without waiting.
// `start` launches the process outside the lane and records it; each step writes the next sample time
// as the body's not-before declaration and the child ends. `run:merge` reads that wait, returns the seat and
// leaves the issue unparked (`run-merge-waits.ts`), and the offer hands it back once the time passes.
//
// **The observed process outlives the lane.** It runs in a new session from the main checkout with the
// lane mark dropped from its environment, so neither `lane_reap`'s tree nor `lane-residents.ts`'s
// directory and mark reads see it. `run:observe` stops it itself, after the last sample.

const SAMPLE_TIMEOUT_MS = 60_000
const MAX_SAMPLE_LENGTH = 500
const TERMINATE_SIGNAL = 'SIGTERM'
const PID_ENV = 'OBSERVE_PID'
const DELIVER = 'pnpm josh run:cut'
const RELAUNCH = 'end this session; the driver relaunches'
const CONTINUE = 'pnpm josh run:step'
// The marks that make a process read as a lane child or the run's parent session.
const DROPPED_ENV: ReadonlySet<string> = new Set([
	...lane_child_mark_keys.MARK_KEYS,
	run_carry_session.KEY,
])

interface ObservePlan {
	command: ReadonlyArray<string>
	sample: string
	offsets_ms: ReadonlyArray<number>
}

interface Launched {
	pid: number
	process_start: string
}

interface ObserveDependencies {
	launch: (command: ReadonlyArray<string>) => Promise<Launched | undefined>
	read_start: (pid: number) => string | undefined
	run_sample: (command: string, pid: number) => string
	stop: (pid: number) => void
	comments: (issue: string) => Promise<ReadonlyArray<string>>
	post: (issue: string, body: string) => Promise<string>
	read_body: (issue: string) => Promise<string>
	edit_body: (issue: string, body: string) => Promise<void>
	now: () => number
}

function cite(issue: string): string {
	return issue_cite.plain_for('program', issue)
}

async function set_wait(
	issue: string,
	at_ms: number | undefined,
	deps: ObserveDependencies,
): Promise<void> {
	await deps.edit_body(issue, issue_not_before.with_date(await deps.read_body(issue), at_ms))
}

// Posts the step and moves the body's wait to the next sample; no next sample drops the wait.
async function record(
	issue: string,
	observed: ObserveRecord,
	note: string,
	deps: ObserveDependencies,
): Promise<string> {
	const url = await deps.post(issue, run_observe_state.comment_of(observed, note))
	const next = run_observe_state.next_at_ms(observed)

	await set_wait(issue, next, deps)

	if (next === undefined) return `${note}: ${url}\nnext: ${DELIVER} ${issue} --deliverable ${url}`

	const until = new Date(next).toISOString()

	return `${note}: waiting until ${until} — ${url}\nnext: ${RELAUNCH} ${cite(issue)} then`
}

async function launched_record(
	plan: ObservePlan,
	retakes: number,
	deps: ObserveDependencies,
): Promise<ObserveRecord> {
	const launched = await deps.launch(plan.command)

	if (launched === undefined) throw new Error(`could not start \`${plan.command.join(' ')}\``)

	const started_at = new Date(deps.now()).toISOString()

	return {
		...plan,
		command: [...plan.command],
		offsets_ms: [...plan.offsets_ms],
		...launched,
		started_at,
		samples: [],
		retakes,
	}
}

async function start(issue: string, plan: ObservePlan, deps: ObserveDependencies): Promise<string> {
	// A sample gate and a not-before date are exclusive (issue-not-before.ts BOTH): refuse before launching.
	if (issue_sample_gate.cited_number(await deps.read_body(issue)) !== undefined) {
		throw new Error(`${cite(issue)} already waits on a sample condition`)
	}

	return await record(issue, await launched_record(plan, 0, deps), 'started', deps)
}

// The observed process is gone or its pid now names another process: one retake, then a failure.
async function retake(
	issue: string,
	observed: ObserveRecord,
	deps: ObserveDependencies,
): Promise<string> {
	if (!run_observe_state.can_retake(observed)) {
		const failed = {
			...observed,
			offsets_ms: observed.offsets_ms.slice(0, observed.samples.length),
		}

		return await record(issue, failed, 'failed — the observed process is gone', deps)
	}

	const relaunched = await launched_record(observed, observed.retakes + 1, deps)

	return await record(issue, relaunched, 'retaken — the observed process was gone', deps)
}

async function take(
	issue: string,
	observed: ObserveRecord,
	deps: ObserveDependencies,
): Promise<string> {
	const value = deps.run_sample(observed.sample, observed.pid)
	const taken_sample = { at: new Date(deps.now()).toISOString(), value }
	const taken = { ...observed, samples: [...observed.samples, taken_sample] }
	const is_last = run_observe_state.next_at_ms(taken) === undefined

	if (is_last) deps.stop(taken.pid)

	return await record(
		issue,
		taken,
		is_last ? 'complete' : `sample ${String(taken.samples.length)}`,
		deps,
	)
}

async function sample(issue: string, deps: ObserveDependencies): Promise<string> {
	const observed = run_observe_state.latest(await deps.comments(issue))

	if (observed === undefined) throw new Error(`${cite(issue)} has no run:observe record`)

	const next = run_observe_state.next_at_ms(observed)

	if (next === undefined) {
		return `${cite(issue)}'s observation is already finished\nnext: ${CONTINUE} ${issue}`
	}

	if (deps.now() < next) {
		return `not due until ${new Date(next).toISOString()}\nnext: ${RELAUNCH} ${cite(issue)} then`
	}

	if (deps.read_start(observed.pid) !== observed.process_start) {
		return await retake(issue, observed, deps)
	}

	return await take(issue, observed, deps)
}

async function launch(command: ReadonlyArray<string>): Promise<Launched | undefined> {
	const [program = '', ...argv] = command
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !DROPPED_ENV.has(key)),
	)
	const child = spawn(program, argv, {
		cwd: await lane_registry.main_repository_root(),
		detached: true,
		env: environment,
		stdio: 'ignore',
	})

	child.unref()

	const process_start = child.pid === undefined ? undefined : process_identity.read_start(child.pid)

	return process_start === undefined ? undefined : { pid: Number(child.pid), process_start }
}

function run_sample(command: string, pid: number): string {
	const printed = execFileSync('sh', ['-c', command], {
		encoding: 'utf8',
		env: { ...process.env, [PID_ENV]: String(pid) },
		timeout: SAMPLE_TIMEOUT_MS,
	})

	return printed.trim().slice(0, MAX_SAMPLE_LENGTH)
}

// The new session's group, so a wrapper and what it started both go.
function stop(pid: number): void {
	try {
		process.kill(-pid, TERMINATE_SIGNAL)
	} catch {
		// Already gone.
	}
}

async function comments(issue: string): Promise<ReadonlyArray<string>> {
	const parsed = await issue_read.parse_comments(await git_gh_issue_read.issue_list_comments(issue))

	return (parsed ?? [])
		.filter((comment) => comment.is_trusted === true)
		.map((comment) => comment.body)
}

// A failed read throws: an empty body written back would erase the Issue.
async function read_body(issue: string): Promise<string> {
	const body = await git_gh_issue_read.issue_get_body(issue)

	if (body === undefined) throw new Error(`could not read ${cite(issue)}'s body`)

	return body
}

const SYSTEM_DEPS: ObserveDependencies = {
	launch,
	read_start: (pid) => process_identity.read_start(pid),
	run_sample,
	stop,
	comments,
	post: async (issue, body) => await git_gh_issue_write.issue_comment(issue, body),
	read_body,
	edit_body: async (issue, body) => {
		await git_gh_issue_write.issue_edit_body(issue, body)
	},
	now: () => Date.now(),
}

const run_observe = { launch, read_body, run_sample, sample, start, stop, SYSTEM_DEPS }

export type { ObserveDependencies, ObservePlan }
export { run_observe }
