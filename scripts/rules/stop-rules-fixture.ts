import type { StopContext } from './stop-rules'

// The quiet stop every stop-rules test starts from: no hold, no run, an English session so the
// English test messages never trip the language rule.
const BASE: StopContext = {
	hold_present: false,
	tree_clean: false,
	prrun_stopped: false,
	notified: false,
	message: '',
	prompt: '',
	stop_hook_active: false,
	cut_pending: false,
	filed: false,
	session_owner: 'joshuafolkken',
	headless_waiting: false,
	headless_refusals: 0,
	lane_child: false,
	background_pending: false,
	agent_pending: false,
	handed_off: false,
	session_lang: 'en',
	headless_agent: false,
	backlog_parent: false,
}

function context(overrides: Partial<StopContext>): StopContext {
	return { ...BASE, ...overrides }
}

const stop_rules_fixture = { context }

export { stop_rules_fixture }
