// Final replies shaped like the live #6253, #6255 and #6227 dispatch logs.
const MESSAGES = [
	'既存描画を拡張して進めてよいですか？\n既存の描画に合わせる案を推奨します。',
	'どちらで進めますか？\n1. 計測を先に行う\n2. 同時実装する\nIssue に記録しました。',
	'目視確認をお願いしています。確認済み、または確認省略の回答後に続行します。',
]

function transcript(message: string): string {
	return [
		JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: message } }),
		JSON.stringify({ type: 'turn.completed' }),
	].join('\n')
}

const run_merge_decision_fixture = { MESSAGES, transcript }

export { run_merge_decision_fixture }
