import { hook_decision } from '#scripts/josh/hook-decision'

// The switch the automatic lane investigations `run:merge` launches — the overrun's
// (`lane-overrun.ts`) and the baseline's (`lane-baseline.ts`) — share (joshuafolkken/kit#5044). It
// defaults off, so an unset variable launches no session; `run:merge` loads `.env`, where it is set.
// Not `JOSH_LANE_OVERRUN`, the mark an investigation session itself carries.
const INVESTIGATION_ENV_KEY = 'JOSH_LANE_INVESTIGATION'

// Read at call time, so a suite that switches the variable between cases is not answered from a cache.
function is_on(): boolean {
	return hook_decision.is_switch_opt_in(INVESTIGATION_ENV_KEY)
}

const lane_investigation_switch = { is_on }

export { lane_investigation_switch }
