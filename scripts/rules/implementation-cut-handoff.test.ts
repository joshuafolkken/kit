import path from 'node:path'
import type { CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_cut_handoff } from '#scripts/run/cut/run-cut-handoff'
import { describe, expect, it } from 'vitest'
import { implementation_cut, type LaneCostState } from './implementation-cut'

// joshuafolkken/kit#4975: the refusal asks for `.josh/tmp/handoff-<N>.json`, but refused that `Write`
// too unless it came inside the reissue window — a run that ran a check first relaunched on the
// previous cut's stale handoff. The handoff write passes at any time; every other edit still refuses.

const ISSUE = '4975'
const OTHER_ISSUE = '4958'
const LANE_DIRECTORY = path.join(path.sep, 'work', '.kit-lanes', ISSUE)
const OVER: CostVerdict = 'over'
const WINDOW_MS = implementation_cut.REISSUE_WINDOW_MS
const PAST_THE_WINDOW_MS = WINDOW_MS + WINDOW_MS
const RELATIVE_HANDOFF = run_cut_handoff.handoff_path_of(ISSUE)
const ABSOLUTE_HANDOFF = path.join(LANE_DIRECTORY, RELATIVE_HANDOFF)
const OTHER_HANDOFF = path.join(LANE_DIRECTORY, run_cut_handoff.handoff_path_of(OTHER_ISSUE))
const OTHER_FILE = path.join(LANE_DIRECTORY, 'scripts', 'x.ts')

function over_threshold_lane(): LaneCostState {
	return {
		directory: LANE_DIRECTORY,
		source: { [lane_child_marker.KEY]: ISSUE },
		carried: () => undefined,
		held_issue: () => undefined,
		verdict: (): CostVerdict => OVER,
		can_cut: (): boolean => true,
	}
}

// The guard refuses an edit when the trigger matches and `decide` fires; the window has passed.
function is_refused(name: string, file_path: string): boolean {
	const call = { name, input: { file_path, content: '{}' } }
	const run = { transcript: '', now_ms: PAST_THE_WINDOW_MS }

	return (
		implementation_cut.is_over_threshold_edit(call, over_threshold_lane()) &&
		implementation_cut.decide(call, run, true, 0)
	)
}

describe('implementation cut — the handoff write', () => {
	it('names the issue in the handoff path', () => {
		expect(RELATIVE_HANDOFF).toBe(`.josh/tmp/handoff-${ISSUE}.json`)
	})

	it('passes the Write to the absolute handoff path past the reissue window', () => {
		expect(is_refused('Write', ABSOLUTE_HANDOFF)).toBe(false)
	})

	it('passes the Write to the handoff path given relative to the checkout', () => {
		expect(is_refused('Write', RELATIVE_HANDOFF)).toBe(false)
	})

	it.each(['Edit', 'Write'])('still refuses a %s to any other file', (name) => {
		expect(is_refused(name, OTHER_FILE)).toBe(true)
	})

	it("still refuses a Write to another issue's handoff path", () => {
		expect(is_refused('Write', OTHER_HANDOFF)).toBe(true)
	})
})
