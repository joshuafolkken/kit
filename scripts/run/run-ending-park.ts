import { run_park_body } from './park/run-park-body'

// The park comment `run:ending`'s `abandoned` verdict hands the parent (joshuafolkken/kit#9064): the
// exit-record basis as the reason, the next step, and the options and recommendation in the `run:park`
// body schema — whose headings and lines `run-park-body.ts` alone defines and `run:park` checks. The
// parent passes it to `run:park --body-file` unchanged, so a person reads what to do next, not only why.
//
// Re-dispatching the same lane is the recommendation; a refused interactive ask in the exit record is
// a question only a person answers, so that park recommends nothing.

interface AbandonedPark {
	basis: string
	has_ask: boolean
	issue: string
}

const [OPTIONS_HEADING, PICK_HEADING] = run_park_body.HEADINGS
const REASON_HEADING = '### 理由'
const NEXT_HEADING = '### 次の一手'
const RETRY_PICK =
	'1 終了記録に拒否された問い合わせが無く、同じレーンを再投入すれば続きから進められる'
const ASK_PICK = '推奨なし — 子が拒否された問い合わせを残したので、その答えは人が決める'
const RETRY_NEXT = '親が選択肢 1 で同じレーンを再投入する。'
const ASK_NEXT = '人が理由にある問い合わせに答えてから、選択肢を選ぶ。'

function options_of(issue: string): ReadonlyArray<string> {
	const retry = `pnpm josh run:add ${issue} --retry`

	return [
		`1. 同じレーンを再投入する（\`${retry}\`）`,
		'   - 層: A',
		`   - 必要な権限: 親（${retry}）`,
		'2. 止めたままにして、人が終了記録を見る',
		'   - 層: B',
		'   - 必要な権限: 人',
	]
}

function abandoned_body(park: AbandonedPark): string {
	return [
		REASON_HEADING,
		`レーンの子が cut を取らずに実装の途中で終わった。根拠: ${park.basis}`,
		NEXT_HEADING,
		park.has_ask ? ASK_NEXT : RETRY_NEXT,
		OPTIONS_HEADING,
		...options_of(park.issue),
		PICK_HEADING,
		park.has_ask ? ASK_PICK : RETRY_PICK,
	].join('\n')
}

const run_ending_park = {
	abandoned_body,
}

export type { AbandonedPark }
export { run_ending_park }
