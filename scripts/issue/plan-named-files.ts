import { existsSync } from 'node:fs'
import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import { lane_plan_auto } from '#scripts/lane/lane-plan-auto'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import { plan_consumers_section } from './plan-consumers-section'

// joshuafolkken/kit#7726: the files a plan will edit, as `issue:plan` counts them against the declared
// estimate — the paths it names outside its existing-consumers section and those of the consumers it
// marks for fixing, each once. Test files sit outside the estimate, and a directory is no one file.

// A bare basename the plan also names by its full path is the same file — unless the repository root
// holds that name, as `SECURITY.md` beside `templates/SECURITY.md`.
function is_restated_basename(path: string, paths: ReadonlyArray<string>): boolean {
	if (path.includes('/') || existsSync(path)) return false

	return paths.some((other) => other.endsWith(`/${path}`))
}

function named_files(plan: string): ReadonlyArray<string> {
	const rows = plan_consumers_section.fixed_rows(plan)
	const fixed = rows.flatMap((row) => [...backlog_overlap.declared_paths(row)])
	const paths = [...new Set([...lane_plan_auto.paths_of(plan), ...fixed])].filter(
		(path) => !path.endsWith('/') && !test_declared_logic.is_test_file(path),
	)

	return paths.filter((path) => !is_restated_basename(path, paths))
}

const plan_named_files = { named_files }

export { plan_named_files }
