import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_provider } from '#scripts/agent/agent-provider'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_hold } from '#scripts/run/hold/run-hold'
import { describe, expect, it } from 'vitest'
import { josh_harness, type JoshEnvironment } from './josh-harness'
import { josh_harness_fixture } from './josh-harness-fixture'

const KINDS = ['kit', 'consumer', 'lane'] as const
const environment = josh_harness_fixture.open_environments(KINDS)
const ISSUE = '5482'
const BRANCH = 'cut-fixes'
const SESSION = 'harness-cut-adopter'
const FINDING = 'code:medium:scripts/a.ts — preserve the review fix'

function session_environment(session: string): Record<string, string | undefined> {
	const removed = Object.fromEntries(
		agent_session_environment.PARENT_SESSION_KEYS.map((key) => [key, undefined]),
	)

	return {
		...josh_harness.CHILD_ENVIRONMENT,
		...removed,
		[agent_provider.CODEX_SESSION_KEY]: session,
	}
}

async function command(
	opened: JoshEnvironment,
	args: ReadonlyArray<string>,
	session: string = SESSION,
): Promise<string> {
	const { executable, leading_arguments } = opened.launcher
	const result = await josh_harness.run_command(
		executable,
		[...leading_arguments, 'run:cut', ...args],
		{
			cwd: opened.root,
			env: session_environment(session),
			timeout_ms: josh_harness.DEFAULT_TIMEOUT_MS,
		},
	)

	expect(result.exit_code, result.stderr).toBe(0)

	return result.stdout
}

async function seed(
	opened: JoshEnvironment,
): Promise<{ cut: string; hold: string; handoff: string }> {
	await git_fixture_workspace.git(opened.root, ['switch', '-c', BRANCH])
	const directory = path.resolve(
		opened.root,
		await git_fixture_workspace.git(opened.root, ['rev-parse', '--git-dir']),
	)
	const hold = run_hold.hold_path(directory)
	const cut = run_cut.cut_path(directory)
	const handoff = path.join(opened.root, 'handoff.json')

	run_hold.create_hold(hold, ISSUE, new Date(), true)
	run_cut.begin_cut(cut, { issue: ISSUE, branch: BRANCH, phase: run_cut.PRE_GATE_PHASE })
	writeFileSync(
		handoff,
		JSON.stringify({
			instruction: 'continue the review fixes',
			completed: [],
			remaining: ['fix Medium'],
			untouched: [],
			findings: [FINDING],
		}),
	)

	return { cut, hold, handoff }
}

async function exercise(opened: JoshEnvironment): Promise<void> {
	const saved = await seed(opened)

	try {
		expect(await command(opened, ['--resume', ISSUE])).toBe('resume')
		expect(await command(opened, ['--resume', ISSUE], 'other-session')).toBe('handed-off')
		expect(await command(opened, ['--impl', ISSUE, '--handoff', saved.handoff])).toBe('cut')
		const read = run_cut.read_cut(saved.cut)

		expect(read).toMatchObject({ kind: 'carried', cut: { handoff: { findings: [FINDING] } } })
		expect(await command(opened, ['--resume', ISSUE], 'successor')).toBe('resume-impl')
	} finally {
		run_cut.end_cut(saved.cut)
		run_hold.release_hold(saved.hold)
	}
}

describe('josh harness — adopted pre-gate cut to implementation cut', () => {
	it.each(KINDS)(
		'carries the findings in %s through real subprocesses',
		async (kind) => {
			await exercise(environment(kind))
		},
		josh_harness_fixture.SCENARIO_TIMEOUT_MS,
	)
})
