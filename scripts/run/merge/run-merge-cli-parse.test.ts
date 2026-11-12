import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_merge_cli } from './run-merge-cli'

const CHILD = '2024'

describe('run_merge_cli.parse — legacy thresholds', () => {
	it('asks the cut verdict without a numeric argument', () => {
		expect(run_merge_cli.parse([CHILD])?.over).toBe(true)
	})

	it('accepts but ignores an in-flight legacy threshold', () => {
		expect(run_merge_cli.parse([CHILD, '--over', '300000'])?.over).toBe(true)
		expect(run_merge_cli.parse([CHILD, '--over', '1'])?.over).toBe(true)
	})

	it('keeps legacy threshold parsing strict', () => {
		expect(run_merge_cli.parse([CHILD, '--over', 'invalid'])).toBeUndefined()
	})
})

describe('run_merge_cli.parse — an omitted --owner', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('resolves the calling session as owner from the pid the session exports', () => {
		vi.spyOn(agent_session_environment, 'own_session_pid').mockReturnValue(process.pid)

		expect(run_merge_cli.parse([CHILD])?.owner.pid).toBe(process.pid)
	})

	it('declares no owner when the session exports no pid', () => {
		vi.spyOn(agent_session_environment, 'own_session_pid').mockReturnValue(undefined)

		expect(run_merge_cli.parse([CHILD])?.owner).toStrictEqual(run_carry.NO_OWNER)
	})
})
