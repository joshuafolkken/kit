import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { run_board_closed } from './run-board-closed'
import { run_board_issue_count } from './run-board-issue-count'
import { run_board_pinned_graphql } from './run-board-pinned-graphql'
import { run_board_plan_shared } from './run-board-plan-shared'
import type { GithubRateLimit } from './run-board-render-quota-github'
import { run_board_snapshot } from './run-board-snapshot'
import type { DataPorts } from './run-board-state'
import { run_board_thanks_read } from './run-board-thanks-read'

// The GitHub, roster and snapshot reads a `run:board` takes (`run-board-data.ts`), wired to the live
// sources — on a live board's worker thread, and where a single frame draws.

// The allowances with the session's transport, which the github row marks with ▶. The transport is
// read without a probe, so the board spends none of the GraphQL allowance it draws; one not known
// yet (or an invalid setting) leaves the allowances unmarked.
async function read_rate_limit_with_transport(): Promise<GithubRateLimit | undefined> {
	const resources = await gh_core_rate_limit.read_resources()
	if (resources === undefined) return undefined

	return { ...resources, transport: await git_gh_transport.known() }
}

function live(): Required<DataPorts> {
	return {
		read_plan: async (scope) => await run_board_plan_shared.read(scope),
		read_closed: async (issues) => await run_board_closed.read_all(issues),
		snapshot: run_board_snapshot.file_store(),
		read_thanks: async () => await run_board_thanks_read.read_thanks(),
		read_rate_limit: read_rate_limit_with_transport,
		read_issue_count: async (repo) => await run_board_issue_count.read_issue_count(repo),
		read_pinned: async (repo) => await run_board_pinned_graphql.read_pinned(repo),
	}
}

const run_board_data_ports = { live }

export { run_board_data_ports }
