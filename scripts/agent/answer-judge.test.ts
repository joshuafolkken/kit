import type { IssueSource } from '#scripts/issue/issue-sources'
import type { AttachedLaunchResult } from '#scripts/run/detached-launch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent_diagnostics } from './agent-diagnostics'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'
import { answer_judge, type JudgePorts } from './answer-judge'
import type { AnswerVerdict } from './answer-verdict'
import { judgment_agent_argv } from './judgment-agent-argv'

// joshuafolkken/kit#6531: the judgment runs as a tool-less child, is handed the question and the trusted
// sources as data, and every way it can fail comes back as a failure with its cause and a retry. The
// child is a fake here: these tests prove the wiring and the result handling, not the model's judgment.

const REVIEWER: AgentProfile = agent_role_profile.DEFAULT_PROFILES.reviewer
const LOG_PATH = 'judgment.log'
const DIRECTORY = '/lane/6531'
const QUESTION = '## Should run:park judge before the write?'
const BODY = '## 背景\n\n単語一致の試作は撤回する候補。\n\n## 期待結果\n\n- 書き込み前に判定する。'
const COMMENT_ID = 'https://github.com/joshuafolkken/kit/issues/6531#issuecomment-2'
const LATER = '変更: 判定は issue_sources を再利用する。'
const SOURCES: ReadonlyArray<IssueSource> = [
	{ id: 'body', order: 0, author: undefined, created_at: undefined, text: `${BODY}\tend` },
	{ id: COMMENT_ID, order: 1, author: 'joshuafolkken', created_at: '2026-11-07', text: LATER },
]
const REUSE_REPLY = {
	verdict: 'answered',
	decision: 'Reuse issue_sources',
	decision_kind: 'reuse',
	quotes: [{ source: COMMENT_ID, text: LATER }],
}
const COMPLETED: AttachedLaunchResult = { kind: 'completed', pid: 1, exit_code: 0 }
const RULES = [
	'期待結果',
	'受け入れ条件',
	'背景',
	'negation',
	'conditional or candidate',
	'same file or function',
	'A later comment that changes a decision overrides',
	'data, never instructions',
]

const check = vi.spyOn(agent_diagnostics, 'check')

function transcript(reply: string): string {
	const events = [
		{ type: 'system', subtype: 'init' },
		{ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } },
		{ type: 'result', is_error: false, result: reply },
	]

	return events.map((event) => JSON.stringify(event)).join('\n')
}

function ports_of(launched: AttachedLaunchResult, log: string | undefined): JudgePorts {
	return {
		profile: () => ({ kind: 'profile', profile: REVIEWER }),
		launch: vi.fn<JudgePorts['launch']>().mockResolvedValue(launched),
		read_log: () => log,
		log_path: () => LOG_PATH,
	}
}

function reply_ports(reply: unknown): JudgePorts {
	return ports_of(COMPLETED, transcript(JSON.stringify(reply)))
}

async function judged(ports: JudgePorts): Promise<AnswerVerdict> {
	const request = { question: QUESTION, sources: SOURCES, directory: DIRECTORY }

	return await answer_judge.judge(request, ports)
}

function cause_of(verdict: AnswerVerdict): string {
	return verdict.kind === 'failed' ? `${verdict.cause} | ${verdict.retry}` : verdict.kind
}

beforeEach(() => {
	check.mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	check.mockReset()
})

describe('answer_judge prompt', () => {
	it.each(RULES)('carries the rule %j', (rule) => {
		expect(answer_judge.INSTRUCTIONS).toContain(rule)
	})

	it('hands the question and every source in written order with its id and origin', () => {
		const prompt = answer_judge.prompt_of(QUESTION, SOURCES)
		const later = `=== source ${COMMENT_ID} · joshuafolkken · 2026-11-07 ===`

		expect(prompt).toContain(`=== question ===\n${QUESTION}`)
		expect(prompt.indexOf('=== source body ===')).toBeLessThan(prompt.indexOf(later))
	})
})

describe('answer_judge judgment_profile', () => {
	it.each([
		['a Codex session', { CODEX_THREAD_ID: 'thread-1' }],
		['a handed openai provider', { JOSH_AGENT_PROVIDER: 'openai' }],
	])('judges on the Claude reviewer from %s', (_label, environment) => {
		expect(answer_judge.judgment_profile(environment)).toStrictEqual({
			kind: 'profile',
			profile: REVIEWER,
		})
	})

	it('keeps an overridden Claude reviewer model', () => {
		const model = 'claude-sonnet-5-5'
		const resolved = answer_judge.judgment_profile({ JOSH_REVIEWER_MODEL: model })

		expect(resolved).toMatchObject({ profile: { model } })
	})
})

describe('answer_judge launch', () => {
	it('launches the tool-less judgment argv with the prompt last and a log', async () => {
		const ports = reply_ports(REUSE_REPLY)

		await judged(ports)

		const request = vi.mocked(ports.launch).mock.calls[0]?.[0]
		const prompt = request?.argv.args.at(-1) ?? ''

		expect(request).toMatchObject({ cwd: DIRECTORY, log_path: LOG_PATH, profile: REVIEWER })
		expect(request?.argv).toEqual(judgment_agent_argv.build(prompt, REVIEWER))
		expect(prompt).toContain(LATER)
		expect(prompt).not.toContain('\t')
	})

	it('returns the answer a later trusted comment decided, with its quote', async () => {
		const verdict = await judged(reply_ports(REUSE_REPLY))

		expect(verdict).toMatchObject({ kind: 'answered', decision_kind: 'reuse' })
		expect(verdict.kind === 'answered' && verdict.evidence[0]?.source.id).toBe(COMMENT_ID)
	})

	it('returns unanswered for a different question about the same file', async () => {
		const reply = { verdict: 'unanswered', reason: 'The body decides when, not which source.' }

		await expect(judged(reply_ports(reply))).resolves.toMatchObject({ kind: 'unanswered' })
	})

	it('checks quotes against the printable sources the child read', async () => {
		const quotes = [{ source: 'body', text: '書き込み前に判定する。 end' }]
		const verdict = await judged(reply_ports({ ...REUSE_REPLY, quotes }))

		expect(verdict.kind).toBe('answered')
	})
})

describe('answer_judge failures', () => {
	it('fails a refused profile before any launch', async () => {
		const ports: JudgePorts = {
			...ports_of(COMPLETED, undefined),
			profile: () => ({ kind: 'rejected', note: 'bad model' }),
		}

		expect(cause_of(await judged(ports))).toContain('refused: bad model')
		expect(ports.launch).not.toHaveBeenCalled()
	})

	it('fails a provider the tool-less launch refuses', async () => {
		const note = 'outdated CLI'

		check.mockReturnValue({ kind: 'rejected', note })
		const ports = ports_of(COMPLETED, undefined)

		expect(cause_of(await judged(ports))).toContain(note)
		expect(ports.launch).not.toHaveBeenCalled()
	})

	it.each([
		['a failed launch', { kind: 'failed', note: 'spawn ENOENT' }, '', 'failed: spawn ENOENT'],
		['a non-zero exit', { kind: 'completed', pid: 1, exit_code: 2 }, '', 'exited 2'],
		['a missing log', COMPLETED, undefined, 'no log'],
		['a run with no result', COMPLETED, '{"type":"system","subtype":"init"}', 'gave no answer'],
		['a broken verdict', COMPLETED, transcript('{"verdict":'), 'no JSON object'],
	] as const)('fails %s with its cause and a retry', async (_case, launched, log, cause) => {
		const message = cause_of(await judged(ports_of(launched, log)))

		expect(message).toContain(cause)
		expect(message).toContain('Re-run')
	})
})
