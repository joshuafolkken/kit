import { describe, expect, it, vi } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { agent_session_role } from './agent-session-role'

const ABSENT_MARK = 'absent mark'

function linked(): boolean {
	return true
}

function unlinked(): boolean {
	return false
}

describe('agent_session_role', () => {
	it.each(['gpt-6.1-sol', 'gpt-6.1-astra', 'claude-fable-5-1'])(
		'uses launcher roles independently of model %s',
		(model) => {
			for (const role of ['scheduler', 'reviewer', undefined, 'unknown', 'worker']) {
				const source = { [agent_session_role.KEY]: role, model }

				expect(agent_session_role.can_implement(source)).toBe(role === 'worker')
				expect(agent_session_role.scope_line(source, linked)).toContain(
					role === 'worker' ? 'implementation is permitted' : 'operations only',
				)
			}
		},
	)

	it('reads the reviewer fragment as a reviewer session', () => {
		const source = agent_session_role.env_for(agent_role_profile.REVIEWER)

		expect(agent_session_role.is_reviewer(source)).toBe(true)
	})

	it.each([
		[ABSENT_MARK, {}],
		['worker', agent_session_role.env_for(agent_role_profile.WORKER)],
		['scheduler', agent_session_role.env_for(agent_role_profile.SCHEDULER)],
		['unknown value', { [agent_session_role.KEY]: '1' }],
	])('reads an %s as a session that is not a reviewer', (_name, source) => {
		expect(agent_session_role.is_reviewer(source)).toBe(false)
	})

	// joshuafolkken/kit#6901: the consultation main line is told apart by its launch, not its model.
	it.each([
		['worker', agent_session_role.env_for(agent_role_profile.WORKER), true],
		['reviewer', agent_session_role.env_for(agent_role_profile.REVIEWER), true],
		['scheduler', agent_session_role.env_for(agent_role_profile.SCHEDULER), true],
		[ABSENT_MARK, {}, false],
		['empty mark', { [agent_session_role.KEY]: '' }, false],
	])('reads a %s session as launched: %s', (_name, source, expected) => {
		expect(agent_session_role.is_launched(source)).toBe(expected)
	})
})

// joshuafolkken/kit#7293: the consultation scope must not read as unconditional filing permission.
describe('agent_session_role.scope_line', () => {
	it('grants filing only on the user’s explicit instruction outside a worker lane', () => {
		const line = agent_session_role.scope_line({}, linked)

		expect(line).toContain('filing only on the user’s explicit instruction')
		expect(line).not.toContain('consultation, filing and operations')
	})

	// joshuafolkken/kit#7783: a filing instruction in consultation is kickoff new, handed off.
	// joshuafolkken/kit#7755: an imperative request goes through investigate, plan and filing plan.
	// joshuafolkken/kit#8943: no-filing work defers tests, the gate and the review to the finish.
	// joshuafolkken/kit#8973: the producer builds in its own worktree, never in this checkout.
	// joshuafolkken/kit#9076: the person may declare no-filing work once for the session.
	it.each([
		'hand it to `pnpm josh run:handoff kickoff new --brief-file <brief>`',
		'imperative request with investigation, a plan and a filing plan',
		'「起票せずに」',
		'investigator and producer subagents, never edited by this session',
		'the producer is dispatched with `isolation: "worktree"` and never edits this checkout',
		'tests, the gate and the review wait for the finish unless asked for now',
		'each such reply ends saying they have not run',
		'declare it for the whole session with 「このセッションは起票せずに」',
		'end it with 「起票せずにモードを終了」 (a resume or `/clear` ends it too)',
		'each closing note also shows the declaration',
	])('names the consultation route outside a worker lane: %s', (phrase) => {
		expect(agent_session_role.scope_line({}, linked)).toContain(phrase)
	})

	// joshuafolkken/kit#8262: a consultation artifact has its own scratch route.
	it('names the scratch route for a consultation artifact outside a worker lane', () => {
		const line = agent_session_role.scope_line({}, linked)

		expect(line).toContain('`.josh/tmp/scratch/`')
		expect(line).toContain('`pnpm josh scratch:run <path>`')
	})

	it('keeps the worker lane line free of the filing plan', () => {
		const line = agent_session_role.scope_line(
			agent_session_role.env_for(agent_role_profile.WORKER),
			unlinked,
		)

		expect(line).toBe(
			'Session scope: implementation lane; implementation is permitted by the launcher role.',
		)
	})
})

// joshuafolkken/kit#7756: nothing can be filed without GitHub, so the line drops the filing plan.
describe('agent_session_role.scope_line without GitHub', () => {
	it('answers an imperative request with a plan only when GitHub is not linked', () => {
		const line = agent_session_role.scope_line({}, unlinked)

		expect(line).toContain('GitHub is not linked')
		expect(line).toContain('investigation and a plan only, without a filing plan')
		expect(line).not.toContain('a plan and a filing plan')
		expect(line).not.toContain('kickoff new')
		expect(line).toContain('Model names and conversational requests do not grant')
	})

	it('reads the GitHub link only outside a worker lane', () => {
		const is_linked = vi.fn(linked)

		agent_session_role.scope_line(agent_session_role.env_for(agent_role_profile.WORKER), is_linked)

		expect(is_linked).not.toHaveBeenCalled()
	})
})
