import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { review_round } from './review-round'

// The paired comparison review (joshuafolkken/kit#6902): with `JOSH_REVIEWER_PAIRED=1`, round 1's code
// brief is copied to a paired brief that a Sonnet reviewer reads beside the Opus one, so the two
// detections can be compared on the same brief. **The paired reviewer is recorded, never gating**: its
// brief tells it to skip `review:attest` and `review:submit` and write its findings to a file of its own,
// which only `josh review:pair` reads — no review slot, attest or merge check reads it.

const PAIRED_ENV = 'JOSH_REVIEWER_PAIRED'
const ENABLED_VALUE = '1'
const BRIEF_PREFIX = 'josh-review-paired-brief-'
const FINDINGS_PREFIX = 'josh-review-paired-findings-'
const PAIRED_PROFILE = agent_role_profile.VERIFICATION_PROFILES.anthropic

interface PairedPaths {
	brief: string
	findings: string
}

function is_enabled(environment: NodeJS.ProcessEnv = process.env): boolean {
	return environment[PAIRED_ENV] === ENABLED_VALUE
}

function paths(directory: string = PROJECT_ROOT): PairedPaths {
	return {
		brief: stamp_file.stamp_path(BRIEF_PREFIX, directory, '.md'),
		findings: stamp_file.stamp_path(FINDINGS_PREFIX, directory, '.txt'),
	}
}

function paired_brief(text: string, findings: string): string {
	return [
		text,
		'',
		'## Paired comparison run — recorded only, never gating',
		'',
		`This overrides the attest and submit steps above: do not run \`review:attest\` or \`review:submit\`. Write your findings to ${findings}, one per line as \`<category>:<severity>:<file>[:<line>] — <sentence>\`, or the single line \`none\`.`,
		'',
	].join('\n')
}

function launch_note(brief: string): string {
	const opening = run_ship_review.round_one_opening(brief)

	return [
		`paired brief: ${brief}`,
		`paired model: ${PAIRED_PROFILE.model} · effort ${PAIRED_PROFILE.effort}`,
		`paired prompt: ${opening}`,
		'Paired comparison on: launch a third `reviewer` beside round 1 with the paired model and prompt; when both return, run `pnpm josh review:pair --issue <N> --opus-agent <id> --sonnet-agent <id>` before `review:record`. Its result never gates.',
	].join('\n')
}

// Round 1's code brief, copied for the paired reviewer when the comparison is on; round 2 is never paired.
function offer(
	text: string,
	environment: NodeJS.ProcessEnv = process.env,
	directory: string = PROJECT_ROOT,
): string | undefined {
	if (!is_enabled(environment) || review_round.from_brief(text) === '2') return undefined
	const { brief, findings } = paths(directory)

	stamp_file.write_text_stamp(brief, `${paired_brief(text, findings)}\n`)
	stamp_file.remove_stamp(findings)

	return launch_note(brief)
}

const review_pair = {
	PAIRED_ENV,
	is_enabled,
	offer,
	paths,
}

export type { PairedPaths }
export { review_pair }
