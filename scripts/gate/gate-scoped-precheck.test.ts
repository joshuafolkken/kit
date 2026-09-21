import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GateTree } from './gate-tree'
import { scoped_green, type ScopedSources } from './scoped-green'
import { verification_gate } from './verification-gate'

// joshuafolkken/kit#2296: the scoped pair already refuses `josh review:brief` on a tree it has not been
// green on; the gate now refuses too, one step earlier, so the first gate is the only gate. This suite
// pins `scoped_precheck_refusal` — when it refuses, and the three exemptions that keep it silent (the
// enforcement is off, CI's `--no-unit`, and `--force`).

const BASE = 'c0ffee01'
const CHANGED_FILE = 'scripts/gate/verification-gate.ts'
const DIGEST = 'digest-before'

function tree_of(digest: string = DIGEST): Record<string, string> {
	return { [CHANGED_FILE]: digest }
}

const GATE_TREE: GateTree = { files: tree_of(), base: BASE }

const DIRECTORY = path.join(tmpdir(), `josh-gate-scoped-precheck-${String(process.pid)}`)

function sources(): ScopedSources {
	return { lint: path.join(DIRECTORY, 'lint.json'), test: path.join(DIRECTORY, 'test.json') }
}

// A green record for both scoped checks on exactly this tree, so the pre-check finds nothing missing.
function plant_green(): ScopedSources {
	const planted = sources()

	review_stamps.lint_related_stamp.write(tree_of(), planted.lint, BASE)
	review_stamps.test_related_stamp.write(tree_of(), planted.test, BASE)

	return planted
}

beforeEach(() => {
	mkdirSync(DIRECTORY, { recursive: true })
	vi.stubEnv(scoped_green.SWITCH_ENV_KEY, '1')
})

afterEach(() => {
	vi.unstubAllEnvs()
	rmSync(DIRECTORY, { recursive: true, force: true })
})

describe('scoped_precheck_refusal — what it enforces', () => {
	it('refuses when enforced and no scoped record covers the tree', () => {
		const refusal = verification_gate.scoped_precheck_refusal(GATE_TREE, {
			is_scoped_enforced: true,
			scoped_sources: sources(),
		})

		expect(refusal).toContain(scoped_green.REFUSAL_HEADLINE)
	})

	it('passes when a green scoped record covers the tree', () => {
		const refusal = verification_gate.scoped_precheck_refusal(GATE_TREE, {
			is_scoped_enforced: true,
			scoped_sources: plant_green(),
		})

		expect(refusal).toBeUndefined()
	})
})

// The three exemptions that keep the pre-check silent: enforcement off (every direct
// `run_verification_gate` call), CI's `--no-unit`, and `--force`.
describe('scoped_precheck_refusal — when it stays silent', () => {
	it('is silent when enforcement is off, however red the tree', () => {
		const refusal = verification_gate.scoped_precheck_refusal(GATE_TREE, {
			scoped_sources: sources(),
		})

		expect(refusal).toBeUndefined()
	})

	it('is silent for a --no-unit gate', () => {
		const refusal = verification_gate.scoped_precheck_refusal(GATE_TREE, {
			is_scoped_enforced: true,
			is_unit_included: false,
			scoped_sources: sources(),
		})

		expect(refusal).toBeUndefined()
	})

	it('is silent for a --force gate', () => {
		const refusal = verification_gate.scoped_precheck_refusal(GATE_TREE, {
			is_scoped_enforced: true,
			is_forced: true,
			scoped_sources: sources(),
		})

		expect(refusal).toBeUndefined()
	})
})
