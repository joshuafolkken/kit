import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { auto_ok_judge } from './auto-ok-judge'

// The plan and subsequent decline on joshuafolkken/kit#7379, reproduced verbatim.
const KICKOFF_PLAN =
	'Auto-decided: 起票・計画だけという今回の実行範囲を守るため、子には `--no-auto-ok` を指定する。既存 backlogrun へ新しい実装を自動投入しない。実装上の人判断が必要という意味ではなく、実行開始は後続の明示指示へ残す。'
const KICKOFF_DECLINE =
	'本文・計画コメントに、起票・計画のみとし auto-ok を付けず既存 backlogrun へ投入しない明示制約がある。実装開始は後続の明示指示へ残されているため、自動投入しない。'
const KICKOFF_BODY = `${issue_body_keys.heading('background')}\n\n${issue_body_keys.line('judgement', 'not_needed')}\n`
const USER_PROHIBITION = [
	'',
	issue_body_keys.heading('auto_execution_constraint'),
	`${issue_body_keys.prefix('constraint_source')} user`,
	`${issue_body_keys.prefix('constraint_reference')} session:original-user-prompt`,
	`${issue_body_keys.prefix('constraint_instruction')} この Issue は自動実行しないでください。`,
	'',
].join('\n')
const PLAN_ID = 1
const DECLINE_ID = 2

function comment(id: number, body: string): Record<string, unknown> {
	return { id, body, author_association: 'OWNER', user: { login: 'joshuafolkken' } }
}

function legacy_comments(): string {
	const decline = auto_ok_judge.comment_of(
		{ is_applied: false, reason: KICKOFF_DECLINE },
		KICKOFF_BODY,
	)

	return JSON.stringify([
		comment(PLAN_ID, `${KICKOFF_PLAN}\n\n<!-- josh:run -->`),
		comment(DECLINE_ID, `${decline.replace(' v=2', '')}\n\n<!-- josh:run -->`),
	])
}

const auto_ok_kickoff_fixture = { legacy_comments }

export { auto_ok_kickoff_fixture, KICKOFF_BODY, KICKOFF_PLAN, USER_PROHIBITION }
