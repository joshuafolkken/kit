// The working directory and environment one hook call is judged under, passed beside its payload
// rather than read off the process, so a process that answers several calls judges each under its own
// (joshuafolkken/kit#6961). A hook launched once per call builds it from the process it runs in.
interface HookContext {
	readonly cwd: string
	readonly env: Readonly<Record<string, string | undefined>>
}

// Built after the hook's `.env` load (`hook_decision.respond_from_stdin`), so the values it loads are in.
function from_process(): HookContext {
	return { cwd: process.cwd(), env: process.env }
}

const hook_context = { from_process }

export type { HookContext }
export { hook_context }
