import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HookContext } from './hook-context'
import { pretool_outcome } from './pretool-guard'
import { step_zero_notice } from './step-zero-notice'

const REFUSED = 'Implementation refused before execution'
const RUNTIME_FILE = path.join('scripts', 'example.ts')
const WORKER = { [agent_session_role.KEY]: 'worker' }

const create_directory = temporary_directory()

// An Edit of a runtime file under a fresh root, its transcript beside it so no stamp carries over.
function runtime_edit(): { root: string; raw_payload: string } {
	const root = create_directory('pretool-context-')
	const raw_payload = JSON.stringify({
		tool_name: 'Edit',
		tool_input: { file_path: path.join(root, RUNTIME_FILE), old_string: 'a', new_string: 'b' },
		transcript_path: path.join(root, 'session.jsonl'),
	})

	return { root, raw_payload }
}

function context_of(cwd: string, environment: HookContext['env']): HookContext {
	return { cwd, env: environment }
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('pretool_outcome — the per-call context', () => {
	it('refuses an edit for the role in the context, not the process role', () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')
		const { root, raw_payload } = runtime_edit()

		expect(pretool_outcome(raw_payload, context_of(root, {})).reason).toContain(REFUSED)
	})

	it('allows an edit for a worker role in the context under a non-worker process', () => {
		vi.stubEnv(agent_session_role.KEY, undefined)
		const { root, raw_payload } = runtime_edit()
		const outcome = pretool_outcome(raw_payload, context_of(root, WORKER))

		expect(outcome.reason ?? '').not.toContain(REFUSED)
	})

	it('reminds Step 0 for an edit under the context cwd', () => {
		const { root, raw_payload } = runtime_edit()

		expect(pretool_outcome(raw_payload, context_of(root, WORKER)).notice).toBe(
			step_zero_notice.NOTICE,
		)
	})

	it('stays quiet on an edit outside the context cwd', () => {
		const { root, raw_payload } = runtime_edit()
		const elsewhere = path.join(root, 'elsewhere')

		expect(pretool_outcome(raw_payload, context_of(elsewhere, WORKER)).notice).toBeUndefined()
	})
})
