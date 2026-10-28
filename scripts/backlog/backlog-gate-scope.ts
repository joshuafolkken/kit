import type { OptedInRead, TrackingRead } from '#scripts/auto-ok/auto-ok-cli'
import { epic_graph } from '#scripts/epic/epic-graph'
import { epic_index } from '#scripts/epic/epic-index'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_state } from '#scripts/lane/lane-state'
import { backlog_plan_comment } from './backlog-plan-comment'
import { backlog_pool } from './backlog-pool'
import type { GateScope } from './backlog-rank'

type OptedIn = Extract<OptedInRead, { kind: 'read' }>
type Tracking = Extract<TrackingRead, { kind: 'read' }>

// Everything the answer is assembled from, read once and passed down rather than re-fetched.
interface PoolContext {
	opted_in: OptedIn
	tracking: Tracking
	repo: string
	exclude: ReadonlyArray<number>
}

// The rows the offer's cap bounds — the standalone half.
function standalone_keys(context: PoolContext): ReadonlySet<string> {
	return backlog_pool.standalone_keys(context.opted_in.issues, {
		tracked: epic_index.withheld_children(context.tracking.index, context.opted_in.issues),
		exclude: context.exclude,
		repo: context.repo,
	})
}

// The issues whose lane yielded on a plan it kept (`lane-yield.ts`) — offered first (`backlog-rank.ts`,
// joshuafolkken/kit#5107).
function yielded_keys(context: PoolContext, directory: string): ReadonlySet<string> {
	const yielded = context.opted_in.issues.filter((issue) =>
		lane_plan.is_yielded(issue.number, directory),
	)

	return new Set(yielded.map(({ number }) => epic_graph.key_of({ number, repo: context.repo })))
}

// The running lanes still carry the pickup label, so the opted-in listing holds their bodies too —
// which is what lets a candidate be held back from a path a running lane already declares.
// `backlog:plan --waves` reads the same scope, so its first wave is this offer. Their lane state
// records name a paused holder in the wait it causes (joshuafolkken/kit#4270); they are local files.
// A lane's recorded plan (joshuafolkken/kit#4864), else a plan comment (joshuafolkken/kit#4923), is
// read in place of the body (joshuafolkken/kit#4937).
async function gate_scope(context: PoolContext): Promise<GateScope> {
	const { issues } = context.opted_in
	const directory = process.cwd()

	return {
		standalone: standalone_keys(context),
		declared: await backlog_plan_comment.declared_of(issues, directory),
		lanes: await lane_state.read_states(issues.map((issue) => String(issue.number))),
		yielded: yielded_keys(context, directory),
	}
}

const backlog_gate_scope = { gate_scope }

export { backlog_gate_scope }
export type { OptedIn, PoolContext }
