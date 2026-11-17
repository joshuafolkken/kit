import { session_language } from '#scripts/josh/session-language'
import { run_stalled } from '#scripts/run/park/run-stalled'

// The prose of a `josh ship` supervisor park (joshuafolkken/kit#7709): the comment's lead line and next
// step, and the warning's body, follow the session language. The park event's cause, the `Cause:` value,
// the commands and the warning's title stay English — `run:board` reads the cause, not this prose.

interface ParkProse {
	lead: string
	body: string
}

interface CapStop {
	reason: string
	kind: string
	relaunches: string
}

const JAPANESE_KIND: Readonly<Record<string, string>> = {
	review: 'レビュー',
	mechanical: '機械的な',
}

function is_japanese(): boolean {
	return session_language.is_japanese(session_language.resolve_session_lang().lang)
}

function cap(stop: CapStop): ParkProse {
	const { reason, kind, relaunches } = stop

	if (!is_japanese()) {
		return {
			lead: `Parked by the \`josh ship\` supervisor: the ship stopped at \`${reason}\` after ${relaunches} relaunches of the lane child for ${kind} stops since its dispatch — the ${kind} stop cap was exceeded.`,
			body: `The lane child's ${kind} stops passed their cap of ${relaunches} relaunches since its dispatch, the last at ${reason}, so it was not relaunched and the issue is parked.`,
		}
	}

	const label = JAPANESE_KIND[kind] ?? kind

	return {
		lead: `\`josh ship\` の監督役が park しました: dispatch 以降、${label}停止でレーン子を ${relaunches} 回再起動したあと \`${reason}\` で止まり、${label}停止の上限を超えました。`,
		body: `レーン子の${label}停止が dispatch 以降の上限 ${relaunches} 回を超え、最後は ${reason} で止まったため、再起動せずに Issue を park しました。`,
	}
}

function timed_out(reason: string): ParkProse {
	if (!is_japanese()) {
		return {
			lead: `Parked by the \`josh ship\` supervisor: the merge wait at \`${reason}\` timed out, which a relaunch of the lane child does not clear, so none was started.`,
			body: `The merge wait at ${reason} timed out, so the lane child was not relaunched and the issue is parked.`,
		}
	}

	return {
		lead: `\`josh ship\` の監督役が park しました: \`${reason}\` でのマージ待ちが時間切れになりました。レーン子を再起動しても解消しないため、再起動していません。`,
		body: `${reason} でのマージ待ちが時間切れになったため、レーン子を再起動せずに Issue を park しました。`,
	}
}

function ci_infra(reason: string): ParkProse {
	if (!is_japanese()) {
		return {
			lead: `Parked by the \`josh ship\` supervisor: CI infrastructure failures outlasted every rerun at \`${reason}\`, which a relaunch of the lane child does not clear, so none was started. Resume it once CI recovers.`,
			body: `CI infrastructure failures outlasted every rerun at ${reason}, so the lane child was not relaunched and the issue is parked until CI recovers.`,
		}
	}

	return {
		lead: `\`josh ship\` の監督役が park しました: \`${reason}\` で CI の基盤障害がすべての再実行を超えて続きました。レーン子を再起動しても解消しないため、再起動していません。CI が回復したら再開してください。`,
		body: `${reason} で CI の基盤障害がすべての再実行を超えて続いたため、レーン子を再起動せずに、CI が回復するまで Issue を park しました。`,
	}
}

function next_step(issue: string): string {
	const log = `pnpm josh ship --log ${issue}`

	if (!is_japanese()) return `Read the stop with \`${log}\`, then ${run_stalled.next_step(issue)}.`

	return `\`${log}\` で停止を読み、${run_stalled.next_step_ja(issue)}`
}

const run_ship_park_prose = { cap, ci_infra, next_step, timed_out }

export { run_ship_park_prose }
