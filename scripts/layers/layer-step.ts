// One command, in one verification layer (joshuafolkken/kit#1313).
//
// The three readers — the gate's own plan, lefthook's hooks, GitHub Actions' workflows — each
// produce these, and the report crosses them with `layer-checks.ts` to find a check that runs in
// more than one of them. The type lives on its own so no reader has to import another one to name
// its own output.

// Whether the command sees only what is staged for the commit, or the whole project. This is the
// distinction that decides whether a repeat is genuinely the same work: a hook that lints two
// staged files and a gate that lints the tree overlap on those two files and nowhere else.
type LayerScope = 'staged' | 'project'

interface LayerStep {
	// `gate`, a lefthook hook name (`pre-commit`, `pre-push`, …), or `ci`. Discovered from the
	// configuration rather than chosen from a list, so a hook added tomorrow becomes a layer.
	layer: string
	// Where in that layer the command sits — a lefthook command name, or `<workflow>/<job>/<step>`.
	step: string
	command: string
	scope: LayerScope
}

const STAGED_SCOPE: LayerScope = 'staged'
const PROJECT_SCOPE: LayerScope = 'project'

export type { LayerScope, LayerStep }
export { PROJECT_SCOPE, STAGED_SCOPE }
