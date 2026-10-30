import { agent_provider } from '#scripts/agent/agent-provider'
import { repository_lock } from '#scripts/git/repository-lock'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const {
	ISSUE,
	CONTEXT_UNDER,
	WITH_FINDINGS_HANDOFF,
	WITH_HANDOFF,
	existing_cut,
	is_attested_on,
	record_check,
	session_verdict,
	target,
	verdict,
	printed_errors,
	launch,
} = run_cut_cli_fixture
const KEY = agent_provider.CODEX_SESSION_KEY
const SESSION = 'adopting-session'
const MISSING_CUT = 'missing fixture cut'

run_cut_cli_fixture.install()
beforeEach(() => {
	for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, undefined)
	vi.stubEnv(KEY, SESSION)
})
afterEach(() => vi.unstubAllEnvs())

async function adopt(): Promise<void> {
	existing_cut()
	await run_cut_cli.run(['--resume', ISSUE])
	expect(verdict()).toBe(run_cut_cli.RESUME_VERDICT)
}

function unrecorded_round(): void {
	is_attested_on.mockReturnValue(true)
	record_check.mockResolvedValue({ status: 'missing', issue: Number(ISSUE) })
}

describe('an adopted pre-gate cut returning to implementation', () => {
	it('carries unrecorded findings through implementation cut and resume', async () => {
		await adopt()
		unrecorded_round()

		await run_cut_cli.run(['--impl', ISSUE, ...WITH_FINDINGS_HANDOFF])
		expect(verdict()).toBe(run_cut_cli.CUT_VERDICT)
		session_verdict.mockReturnValue(CONTEXT_UNDER)
		vi.stubEnv(KEY, 'successor')
		await run_cut_cli.run(['--resume', ISSUE])

		expect(verdict()).toBe(run_cut_cli.RESUME_IMPL_VERDICT)
		expect(printed_errors()).toContain('code:medium:scripts/a.ts — a finding')
		expect(launch).toHaveBeenCalledOnce()
	})
})

describe('another session cannot replace the adoption', () => {
	it('preserves an unknown Claude adoption with a whitespace identity', async () => {
		vi.stubEnv(KEY, undefined)
		vi.stubEnv(agent_session_environment.SESSION_ID_KEY, ' ')
		await adopt()
		const previous = stamp_file.read_stamp_text(target())

		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect(verdict()).toBe(run_cut_cli.BUSY_VERDICT)
		expect(stamp_file.read_stamp_text(target())).toBe(previous)
		expect(launch).not.toHaveBeenCalled()
	})

	it.each(['foreign-session', undefined, ''])(
		'preserves another or unknown adopter for %j',
		async (session) => {
			await adopt()
			const previous = stamp_file.read_stamp_text(target())

			vi.stubEnv(KEY, session)

			await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

			expect(verdict()).toBe(run_cut_cli.BUSY_VERDICT)
			expect(stamp_file.read_stamp_text(target())).toBe(previous)
			expect(launch).not.toHaveBeenCalled()
		},
	)

	it('preserves a legacy adopted record without an owner', async () => {
		await adopt()
		const read = run_cut.read_cut(target())
		if (read.kind !== 'carried') throw new Error(MISSING_CUT)

		stamp_file.replace_stamp(target(), { ...read.cut, adopted_session: undefined })
		const previous = stamp_file.read_stamp_text(target())

		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect(verdict()).toBe(run_cut_cli.BUSY_VERDICT)
		expect(stamp_file.read_stamp_text(target())).toBe(previous)
	})
})

describe('validation before replacement', () => {
	it('preserves the adopted record when the findings handoff is missing', async () => {
		await adopt()
		const previous = stamp_file.read_stamp_text(target())

		unrecorded_round()

		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect(verdict()).toBe(run_cut_cli.BAD_HANDOFF_VERDICT)
		expect(stamp_file.read_stamp_text(target())).toBe(previous)
	})
})

describe('cut diagnostics during mutation', () => {
	it('reads JSON while the mutation lock is held', async () => {
		existing_cut()
		const previous = stamp_file.read_stamp_text(target())

		await repository_lock.with_lock(
			async () => {
				expect(await run_cut_cli.run(['--json'])).toBe(0)
				expect(JSON.parse(verdict())).toMatchObject({ verdict: 'carried', cut: { issue: ISSUE } })
			},
			`${target()}.lock`,
			0,
		)

		expect(stamp_file.read_stamp_text(target())).toBe(previous)
	})
})

describe('concurrent cut commands', () => {
	it('allows only one implementation cut after adoption', async () => {
		await adopt()
		const args = ['--impl', ISSUE, ...WITH_HANDOFF]

		const codes = await Promise.all([run_cut_cli.run(args), run_cut_cli.run(args)])

		expect(codes).toContain(0)
		expect(codes).toContain(1)
		expect(launch).toHaveBeenCalledOnce()
		expect(run_cut.read_cut(target())).toMatchObject({
			kind: 'carried',
			cut: { is_handed_off: true, phase: run_cut.IMPLEMENTATION_PHASE },
		})
	})

	it('allows only one concurrent pre-gate adoption', async () => {
		existing_cut()
		const args = ['--resume', ISSUE]

		const codes = await Promise.all([run_cut_cli.run(args), run_cut_cli.run(args)])

		expect(codes).toContain(0)
		expect(codes).toContain(1)
		expect(run_cut.read_cut(target())).toMatchObject({
			kind: 'carried',
			cut: { is_handed_off: false, adopted_session: `openai:${SESSION}` },
		})
	})
})

describe('expired adoption ownership', () => {
	it('preserves an expired adoption owned by another session', async () => {
		await adopt()
		const read = run_cut.read_cut(target())

		if (read.kind !== 'carried') throw new Error(MISSING_CUT)

		stamp_file.replace_stamp(target(), { ...read.cut, cut_at: '2000-01-01T00:00:00.000Z' })
		const previous = stamp_file.read_stamp_text(target())

		vi.stubEnv(KEY, 'other-session')
		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect(verdict()).toBe(run_cut_cli.BUSY_VERDICT)
		expect(stamp_file.read_stamp_text(target())).toBe(previous)
	})
})
