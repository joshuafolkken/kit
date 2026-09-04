import { gate_plan } from '#scripts/gate-plan'
import { layer_ci } from './layer-ci'
import { layer_hooks } from './layer-hooks'
import { PROJECT_SCOPE, type LayerStep } from './layer-step'

// Every verification layer this project has, in the order a change passes through them
// (joshuafolkken/kit#1313): the local gate, then the git hooks, then CI.
//
// **The gate has no file to read, and is not written down here either.** `gate-plan.ts` is where
// `josh gate` declares the checks it runs, and this reader turns that same list into layer steps —
// so the gate half of the answer moves with the gate rather than with this command.

const GATE_LAYER = 'gate'
const JOSH_PREFIX = 'pnpm josh'

// The gate always reads the whole project: it takes no file list, and `josh lint:related` — which
// does — is a separate command the gate never reaches.
function gate_steps(): Array<LayerStep> {
	return gate_plan.GATE_CHECKS.map((check) => ({
		layer: GATE_LAYER,
		step: check.label,
		command: `${JOSH_PREFIX} ${check.target}`,
		scope: PROJECT_SCOPE,
	}))
}

// The order matters only for how the layers are printed; the duplication itself is order-free.
function read_layer_steps(root: string): Array<LayerStep> {
	return [...gate_steps(), ...layer_hooks.read_hook_steps(root), ...layer_ci.read_ci_steps(root)]
}

const layer_sources = { GATE_LAYER, gate_steps, read_layer_steps }

export { layer_sources }
