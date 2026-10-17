import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { hook_decision } from '#scripts/josh/hook-decision'

// The two most-refused Bash rows, `file-body` and `piped-verification`, delivered ahead of the call
// that would break them. A refusal teaches the rule only after the call was composed, and each
// refusal is a round trip spent rewriting it (joshuafolkken/kit#3996). The first Bash call of a
// session comes before any of those, so the hook that sees it carries the two rules as a notice.
//
// **The rows themselves are unchanged.** They still refuse on every occurrence; this only puts their
// text in front of the first call, the way `step-zero-notice.ts` delivers Step 0 at the first edit.
//
// **Once per session**, on a stamp keyed by the transcript. A stamp that cannot be written stays
// silent rather than repeating the notice on every call.
const STAMP_PREFIX = 'josh-shell-rules-notice-'

const NOTICE =
	'Shell rules: change an existing file with Edit or Write, never a script or heredoc that writes it (file-edits.md); run a josh check with no pipe or under `set -o pipefail`, never `| head` (output-bounds.md).'

const STAMP = hook_decision.create_refusal_stamp(STAMP_PREFIX)

function notice(raw_payload: string): string | undefined {
	const payload = hook_decision.parse_hook_payload(raw_payload)

	if (payload?.tool_name !== cost_blocks.BASH_TOOL) return undefined

	const target = STAMP.path(payload.transcript_path)

	if (STAMP.last_ms(target) !== hook_decision.NEVER_MS || !STAMP.record(target, Date.now())) {
		return undefined
	}

	return NOTICE
}

const shell_rules_notice = { NOTICE, notice, stamp_path: STAMP.path }

export { shell_rules_notice }
