import { auto_ok_judge } from './auto-ok-judge'

// The issues and comments the `josh auto-ok:judge` tests read: a listing row, the `labels,body` read
// the write half re-reads before acting, and the comment that marks an issue as already judged.

const OWED_NUMBER = 7
const JUDGED_NUMBER = 8
const OPTED_IN_NUMBER = 9
const BODY = 'Fix the thing.'
const UPDATED_AT = '2026-10-15T00:00:00Z'
// An author with write access; a third party's issue or comment is `NONE`.
const TRUSTED = 'OWNER'
const UNTRUSTED = 'NONE'
const DECLINED = { is_applied: false, reason: 'a policy decision is needed' }

function judgement_comments(): string {
	return JSON.stringify([
		{
			id: 1,
			user: { login: 'joshuafolkken' },
			author_association: TRUSTED,
			body: auto_ok_judge.comment_of(DECLINED, BODY),
		},
	])
}

function comments_of(issue: string): string {
	return issue === String(JUDGED_NUMBER) ? judgement_comments() : '[]'
}

function row(
	number: number,
	labels: ReadonlyArray<string> = [],
	author_association = TRUSTED,
): Record<string, unknown> {
	return {
		number,
		title: `Issue ${String(number)}`,
		body: BODY,
		labels: labels.map((name) => ({ name })),
		updatedAt: UPDATED_AT,
		author_association,
	}
}

function labels_and_body(labels: ReadonlyArray<string>): string {
	return JSON.stringify({ labels: labels.map((name) => ({ name })), body: BODY })
}

const auto_ok_judge_fixture = { comments_of, labels_and_body, row }

export {
	auto_ok_judge_fixture,
	DECLINED,
	JUDGED_NUMBER,
	OPTED_IN_NUMBER,
	OWED_NUMBER,
	TRUSTED,
	UNTRUSTED,
}
