#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_paths, type LaneEnvironment } from '#scripts/lane/lane-paths'

// Refuse a dependency update inside a lane (joshuafolkken/kit#2135).
//
// `latest:scope` reads how long ago `josh latest` last finished, and that stamp is keyed to the
// project root. A lane is a linked work tree whose project root is its own directory, so a fresh
// lane has no stamp, is told `required`, and every lane would run its own dependency update — landing
// an unrelated lock-file diff on that child's pull request, where `/code-review` and CI attribute it
// to the child and the eslint cache key (`hashFiles('pnpm-lock.yaml')`) misses. `backlogrun-lanes.md`
// and `backlogrun-child.md` both forbid it in prose; this module is what stops it. It is the single
// source of both the `skip` reason `latest:scope` prints in a lane and the refusal `josh latest`
// prints, and it fronts the `josh latest` chain as `josh latest:guard` so the pnpm bump never mutates
// `package.json` before the refusal is reached.
const STAMP_NOTE =
	'the josh latest stamp is keyed to the project root, so a fresh lane has no record and always reads as stale'
const PRIMARY_NOTE = 'run josh latest in the primary checkout, never in a lane'
const LANE_SCOPE_REASON = `inside a lane — ${STAMP_NOTE}; ${PRIMARY_NOTE}`
const LANE_REFUSAL = `josh latest is refused inside a lane — ${STAMP_NOTE}; ${PRIMARY_NOTE}`
const REFUSAL_EXIT_CODE = 1

// The path test that needs no git, so it is safe in a synchronous CLI: `lane_issue_of` reads the
// lane number off the directory name rather than parsing `git worktree list`.
function is_lane(cwd: string = process.cwd(), environment: LaneEnvironment = process.env): boolean {
	return lane_paths.lane_issue_of(cwd, environment) !== undefined
}

// `josh latest:guard` — the head of the `josh latest` chain. It exits non-zero inside a lane so the
// `&&`-joined steps after it (the pnpm bump, the dependency update, the audit) never run, and stays silent
// in the primary checkout so the chain proceeds.
function main(): void {
	if (!is_lane()) return

	console.error(LANE_REFUSAL)
	process.exitCode = REFUSAL_EXIT_CODE
}

const latest_lane_guard = {
	LANE_REFUSAL,
	LANE_SCOPE_REASON,
	REFUSAL_EXIT_CODE,
	is_lane,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { latest_lane_guard }
