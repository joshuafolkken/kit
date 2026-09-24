import type { StopContext } from './stop-rules'

// The quiet stop every stop-rules test starts from: no hold, no run, an English session so the
// English test messages never trip the language rule.
const BASE: StopContext = {
	hold_present: false,
	tree_clean: false,
	notified: false,
	message: '',
	stop_hook_active: false,
	cut_pending: false,
	filed: false,
	session_owner: 'joshuafolkken',
	headless_waiting: false,
	headless_refusals: 0,
	owes_offer: false,
	lane_child: false,
	session_lang: 'en',
}

function context(overrides: Partial<StopContext>): StopContext {
	return { ...BASE, ...overrides }
}

const stop_rules_fixture = { context }

export { stop_rules_fixture }
