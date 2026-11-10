import { lane_reap } from '#scripts/lane/lane-reap'

// The working directory, environment and process ancestry one hook call is judged under, passed beside
// its payload rather than read off the process, so a process that answers several calls judges each
// under its own (joshuafolkken/kit#6961). A hook launched once per call builds it from the process it
// runs in. `ancestry` is the call's process and every one above it, which tells the session that owns
// a carry record apart (`run_headless.is_owned_here`).
interface HookContext {
	readonly cwd: string
	readonly env: Readonly<Record<string, string | undefined>>
	readonly ancestry: () => ReadonlySet<number>
}

// Built after the hook's `.env` load (`hook_decision.respond_from_stdin`), so the values it loads are in.
function from_process(): HookContext {
	return { cwd: process.cwd(), env: process.env, ancestry: lane_reap.own_ancestry }
}

const hook_context = { from_process }

export type { HookContext }
export { hook_context }
