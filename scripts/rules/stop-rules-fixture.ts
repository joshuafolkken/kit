import { stop_rules, type StopAction, type StopContext } from './stop-rules'

// The quiet stop every stop-rules test starts from: no hold, no run, an English session so the
// English test messages never trip the language rule, and no prompt read so the length and close
// rules stay quiet — their tests start from `prose_context`.
const BASE: StopContext = {
	hold_issue: undefined,
	hold_owned: true,
	answers_question: false,
	tree_clean: false,
	prrun_stopped: false,
	notified: false,
	message: '',
	prompt: undefined,
	stop_hook_active: false,
	cut_pending: false,
	filed: false,
	session_owner: 'joshuafolkken',
	headless_waiting: false,
	headless_refusals: 0,
	lane_child: false,
	background_pending: false,
	agent_pending: false,
	command_pending: false,
	notice_queued: false,
	handed_off: false,
	session_lang: 'en',
	headless_agent: false,
	backlog_parent: false,
	started_child: false,
}

function context(overrides: Partial<StopContext>): StopContext {
	return { ...BASE, ...overrides }
}

// A stop whose person's prompt was read, so the rules reading the reply's prose — its length and
// its close — judge it.
function prose_context(overrides: Partial<StopContext>): StopContext {
	return context({ prompt: '', ...overrides })
}

// The kinds of the actions a stop runs, in the order it runs them.
function action_kinds(overrides: Partial<StopContext>): ReadonlyArray<StopAction['kind']> {
	return stop_rules.stop_outcome(context(overrides)).actions.map((action) => action.kind)
}

// A held stop's reply that names its decision, and the decision the notify carries from it.
const DECISION_MESSAGE = 'paused\nRecommended: merge it'
const DECISION = { recommended: 'merge it', alternative: undefined }

const stop_rules_fixture = { DECISION, DECISION_MESSAGE, action_kinds, context, prose_context }

export { stop_rules_fixture }
