import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scoped_green, type ScopedSources } from './scoped-green'

// joshuafolkken/kit#4905: `metrics --accept` after the scoped pair passed wrote under `.josh/`, and the
// ship preflight re-ran both checks over nothing but that bookkeeping. The records are written to an
// explicit temp path, never the real per-checkout one (`scoped-green.test.ts`).

const BASE = 'f4d79002'
const MOVED_BASE = 'a22b3479'
const SOURCE = 'scripts/gate/scoped-green.ts'
const METRICS_RECORD = '.josh/metrics-accepted/4905.json'
const LOOKALIKE_FILE = 'scripts/.josh/metrics.json'
const DIGEST = 'digest-before'
const EDITED_DIGEST = 'digest-after'
const BOTH_SCRIPTS = [scoped_green.LINT_SCRIPT, scoped_green.TEST_SCRIPT]

const DIRECTORY = path.join(tmpdir(), `josh-scoped-green-records-suite-${String(process.pid)}`)

function plant_both(base: string = BASE): ScopedSources {
	const planted = {
		lint: path.join(DIRECTORY, 'lint.json'),
		test: path.join(DIRECTORY, 'test.json'),
		is_unit_skipped: false,
	}

	review_stamps.lint_related_stamp.write({ [SOURCE]: DIGEST }, planted.lint, base)
	review_stamps.test_related_stamp.write({ [SOURCE]: DIGEST }, planted.test, base)

	return planted
}

beforeEach(() => {
	mkdirSync(DIRECTORY, { recursive: true })
})

afterEach(() => {
	rmSync(DIRECTORY, { recursive: true, force: true })
})

describe('missing_scripts — josh records under .josh/', () => {
	it('keeps both records when only a josh record under .josh/ was written since them', () => {
		const tree = { [SOURCE]: DIGEST, [METRICS_RECORD]: DIGEST }

		expect(scoped_green.missing_scripts(tree, BASE, plant_both())).toStrictEqual([])
	})

	it('re-runs both checks when a source moved beside a josh record', () => {
		const tree = { [SOURCE]: EDITED_DIGEST, [METRICS_RECORD]: DIGEST }

		expect(scoped_green.missing_scripts(tree, BASE, plant_both())).toStrictEqual(BOTH_SCRIPTS)
	})

	it('re-runs both checks when a path only named like the record directory moved', () => {
		const tree = { [SOURCE]: DIGEST, [LOOKALIKE_FILE]: DIGEST }

		expect(scoped_green.missing_scripts(tree, BASE, plant_both())).toStrictEqual(BOTH_SCRIPTS)
	})

	it('re-runs both checks when the change base moved, whatever else is a josh record', () => {
		const tree = { [SOURCE]: DIGEST, [METRICS_RECORD]: DIGEST }

		expect(scoped_green.missing_scripts(tree, BASE, plant_both(MOVED_BASE))).toStrictEqual(
			BOTH_SCRIPTS,
		)
	})
})

// joshuafolkken/kit#5156: `check:related` has no gate behind it to lint and test a moved `.josh/`
// record, so the exemption the ship preflight takes does not carry over to reuse.
describe('green_scripts — josh records under .josh/', () => {
	it('reuses neither record when a josh record under .josh/ was written since them', () => {
		const tree = { [SOURCE]: DIGEST, [METRICS_RECORD]: DIGEST }

		expect(scoped_green.green_scripts(tree, BASE, plant_both())).toStrictEqual([])
	})

	it('reuses both records when the tree is the one they describe', () => {
		const tree = { [SOURCE]: DIGEST }

		expect(scoped_green.green_scripts(tree, BASE, plant_both())).toStrictEqual(BOTH_SCRIPTS)
	})
})
