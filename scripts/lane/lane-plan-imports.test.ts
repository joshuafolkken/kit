import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { main_guard } from '#scripts/lib/main-guard'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan_imports } from './lane-plan-imports'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#5928: joshuafolkken/kit#5846 imported `epic.ts`, which ran `main()` on import, and
// found out only from `main-guard-boundary.test.ts` after implementing. The plan names it first.

const DIRECTORY = make_directory('lane-plan-imports-')
const ISSUE = '5846'
const GUARDED = 'epic-audit-cli.ts'
const UNCONDITIONAL = 'epic.ts'
const IMPORTABLE = 'epic-schema.ts'
const NEW_FILE = 'run-split.ts'
const PLAN = [ISSUE, NEW_FILE]

const error = vi.spyOn(console, 'error')

writeFileSync(
	path.join(DIRECTORY, GUARDED),
	'if (process.argv[1] === fileURLToPath(import.meta.url)) await main()\n',
)
// The shape `epic.ts` had: the call inside a top-level `try`.
writeFileSync(
	path.join(DIRECTORY, UNCONDITIONAL),
	'async function main() {}\ntry {\n\tawait main()\n} catch {\n\tprocess.exit(1)\n}\n',
)
writeFileSync(path.join(DIRECTORY, IMPORTABLE), 'export const epic_schema = {}\n')

beforeEach(() => {
	error.mockImplementation(vi.fn())
})

describe('lane_plan_imports.split', () => {
	it('takes the paths after `--imports` out of the plan', () => {
		expect(lane_plan_imports.split([...PLAN, '--imports', GUARDED, UNCONDITIONAL])).toEqual({
			plan: PLAN,
			imports: [GUARDED, UNCONDITIONAL],
		})
	})

	it('leaves a plan without `--imports` whole', () => {
		expect(lane_plan_imports.split(PLAN)).toEqual({ plan: PLAN, imports: [] })
	})
})

describe('lane_plan_imports.report', () => {
	it('names a main guard and an unconditional main(), then the prerequisite split', () => {
		lane_plan_imports.report(ISSUE, [GUARDED, IMPORTABLE, UNCONDITIONAL], DIRECTORY)

		expect(error.mock.calls.map(([line]) => String(line))).toEqual([
			`import blocked: ${GUARDED} — ${main_guard.GUARD_REASON}`,
			`import blocked: ${UNCONDITIONAL} — ${main_guard.UNCONDITIONAL_REASON}`,
			expect.stringContaining(`pnpm josh run:split ${ISSUE} --prerequisite <P>`),
		])
	})

	it('prints nothing when every module can be imported or does not exist yet', () => {
		lane_plan_imports.report(ISSUE, [IMPORTABLE, NEW_FILE], DIRECTORY)
		lane_plan_imports.report(ISSUE, [], DIRECTORY)

		expect(error).not.toHaveBeenCalled()
	})
})
