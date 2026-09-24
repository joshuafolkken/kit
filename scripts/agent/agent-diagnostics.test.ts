import { describe, expect, it, vi } from 'vitest'
import { agent_diagnostics, type DiagnosticPorts, type ProcessOutcome } from './agent-diagnostics'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'

const OPENAI_WORKER = agent_role_profile.OPENAI_PROFILES.worker
const ANTHROPIC_WORKER = agent_role_profile.DEFAULT_PROFILES.worker
const NOT_LOGGED_IN = 'Not logged in'
const CODEX_READY: ProcessOutcome = { status: 0, stdout: 'codex-cli 0.156.1' }
const CLAUDE_READY: ProcessOutcome = { status: 0, stdout: '2.1.280 (Claude Code)' }
const LOGGED_IN: ProcessOutcome = { status: 0, stdout: 'Logged in' }

function ports(...outcomes: ReadonlyArray<ProcessOutcome>): DiagnosticPorts {
	const run = vi.fn()

	for (const outcome of outcomes) run.mockReturnValueOnce(outcome)

	return { run }
}

function note(profile: AgentProfile, fake: DiagnosticPorts): string {
	const result = agent_diagnostics.check(profile, fake)

	return result.kind === 'rejected' ? result.note : ''
}

describe('OpenAI launch diagnostics', () => {
	it('accepts a Codex CLI that can run the model and is authenticated', () => {
		const fake = ports(CODEX_READY, LOGGED_IN)

		expect(agent_diagnostics.check(OPENAI_WORKER, fake)).toStrictEqual({ kind: 'ready' })
		expect(fake.run).toHaveBeenNthCalledWith(1, 'codex', ['--version'])
		expect(fake.run).toHaveBeenNthCalledWith(2, 'codex', ['login', 'status'])
	})

	it('reports a missing CLI without retry or provider fallback', () => {
		const fake = ports({ status: undefined, error: new Error('spawn codex ENOENT') })

		expect(note(OPENAI_WORKER, fake)).toContain('ENOENT')
		expect(fake.run).toHaveBeenCalledTimes(1)
	})

	it('reports missing authentication without retry', () => {
		const fake = ports(CODEX_READY, { status: 1, stderr: NOT_LOGGED_IN })

		expect(note(OPENAI_WORKER, fake)).toContain(NOT_LOGGED_IN)
		expect(fake.run).toHaveBeenCalledTimes(2)
	})
})

// joshuafolkken/kit#2415: a CLI too old for the pinned model refuses the launch with the update to run,
// and never falls back to a model the old CLI could run.
describe('Codex model compatibility diagnostics', () => {
	it('refuses a Codex CLI older than the model floor, naming the update', () => {
		const fake = ports({ status: 0, stdout: 'codex-cli 0.154.0-alpha.6.1' })
		const message = note(OPENAI_WORKER, fake)

		expect(message).toContain('0.155.0')
		expect(message).toContain('npm install -g @openai/codex@latest')
		expect(fake.run).toHaveBeenCalledTimes(1)
	})

	it('treats a prerelease of the floor as older than the floor', () => {
		expect(
			note(OPENAI_WORKER, ports({ status: 0, stdout: 'codex-cli 0.155.0-alpha.1' })),
		).toContain('0.155.0 or later')
	})
})

describe('Claude Code model compatibility diagnostics', () => {
	it('accepts a Claude Code CLI at the floor with a single version check', () => {
		const fake = ports(CLAUDE_READY)

		expect(agent_diagnostics.check(ANTHROPIC_WORKER, fake)).toStrictEqual({ kind: 'ready' })
		expect(fake.run).toHaveBeenCalledExactlyOnceWith('claude', ['--version'])
	})

	it('refuses a Claude Code CLI older than the model floor, naming the update', () => {
		const message = note(ANTHROPIC_WORKER, ports({ status: 0, stdout: '2.1.156 (Claude Code)' }))

		expect(message).toContain('claude-opus-5-5')
		expect(message).toContain('2.1.280')
		expect(message).toContain('claude update')
	})

	it('refuses when the version cannot be read rather than assuming support', () => {
		expect(note(ANTHROPIC_WORKER, ports({ status: 0, stdout: 'unknown build' }))).toContain(
			'could not be read',
		)
		expect(note(ANTHROPIC_WORKER, ports({ status: 1, stderr: 'broken' }))).toContain('broken')
	})

	it('leaves a recorded pre-migration model unchecked so an existing lane resumes', () => {
		const fake = ports()
		const legacy = { ...ANTHROPIC_WORKER, model: 'opus' }

		expect(agent_diagnostics.check(legacy, fake)).toStrictEqual({ kind: 'ready' })
		expect(fake.run).not.toHaveBeenCalled()
	})
})
