import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_headless } from '#scripts/run/run-headless'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { run_carry, type CarryOwner } from './run-carry'
import { run_carry_args } from './run-carry-args'

// joshuafolkken/kit#3708: a record says when its owner is a session the run launched headless, so
// `josh backlogrun --stop` knows that owner for the run's own after the supervisor's record is gone.
// Colocated apart from `run-carry.test.ts` to keep that file under its line ceiling.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-headless-'))
const TARGET = run_carry.carry_path(path.join(scratch, 'repository.git'))
const INVOCATION = 'backlogrun --max 5'
const ISSUE = '3708'
const HEADLESS_VALUE = '1'
const OWN_PID = String(process.pid)

function dead_owner(): CarryOwner {
	return run_carry.owner_of(process_identity_fixture.DEAD_PID)
}

// The owner `run:carry --owner` declares under the given lane-child mark, headless mark set.
function declared_owner(lane_child: string | undefined): CarryOwner | undefined {
	vi.stubEnv(run_headless.HEADLESS_ENV_KEY, HEADLESS_VALUE)
	vi.stubEnv(lane_child_marker.KEY, lane_child)

	const parsed = run_carry_args.read_arguments(['--resume', INVOCATION, '--owner', OWN_PID])
	const request = parsed === undefined ? undefined : run_carry_args.to_request(parsed)

	return request?.kind === 'claim' ? request.claim.owner : undefined
}

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('the headless owner mark', () => {
	it('marks the owner where the run launched the calling session headless', () => {
		expect(declared_owner(undefined)).toStrictEqual({
			...run_carry.owner_of(process.pid),
			is_headless: true,
		})
	})

	it('leaves a lane child that inherited the headless mark unmarked', () => {
		expect(declared_owner(ISSUE)).toStrictEqual(run_carry.owner_of(process.pid))
	})

	it('is written with the owner, and read back off the record', () => {
		run_carry.end_carry(TARGET)

		const carry = run_carry.begin_carry(TARGET, INVOCATION, { ...dead_owner(), is_headless: true })

		expect(carry?.is_owner_headless).toBe(true)
		expect(run_carry.read_carry(TARGET)).toMatchObject({ carry: { is_owner_headless: true } })
	})

	it('does not survive an adoption by an attached session', () => {
		run_carry.end_carry(TARGET)

		const headless = { ...dead_owner(), is_headless: true }
		const begun = run_carry.begin_carry(TARGET, INVOCATION, headless)

		if (begun === undefined) throw new Error('the scratch record was claimed by something else')

		const cut = run_carry.apply_change(TARGET, begun, { cuts: 1 })

		expect(run_carry.adopt_carry(TARGET, cut, dead_owner())?.is_owner_headless).toBeUndefined()
	})
})
