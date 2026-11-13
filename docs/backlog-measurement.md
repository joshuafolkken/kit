# Backlog 起動の隔離計測

kit checkout で `pnpm exec tsx tools/backlog/backlog-measure.ts <input.json>` を実行する。
入口は本番の候補取得・候補cache・driverを呼び、計測専用の Git repository、状態、cache、worker記録先を試行ごとに作る。現行ランの停止・再起動は行わない。

## 固定入力

次は候補1件、依存待機5件の完全なオフライン入力。候補複数の条件では各行の `blockedBy` を取り除く。実行回数は `repetitions`、空き枠・メモリー待機・使用量待機は `free_lanes`、`memory_held`、`usage_limited`、起動済みは `in_flight` で指定する。

```json
{
	"name": "one-and-five",
	"mode": "cold",
	"repetitions": 5,
	"free_lanes": 2,
	"reads": [
		{
			"method": "gh.issue_list_by_label_summary",
			"args": ["auto-ok", 200],
			"encoding": "listing",
			"value": [
				{
					"number": 901,
					"title": "Ready",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }]
				},
				{
					"number": 902,
					"title": "Wait 1",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 903,
					"title": "Wait 2",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 904,
					"title": "Wait 3",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 905,
					"title": "Wait 4",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				},
				{
					"number": 906,
					"title": "Wait 5",
					"createdAt": "2026-09-01T00:00:00Z",
					"author_association": "OWNER",
					"body": "",
					"labels": [{ "name": "auto-ok" }, { "name": "run:lane" }],
					"blockedBy": { "nodes": [{ "number": 901 }] }
				}
			]
		},
		{
			"method": "gh.issue_list_by_label",
			"args": ["not-before", 200],
			"encoding": "listing",
			"value": []
		},
		{
			"method": "gh.issue_list_by_label",
			"args": ["epic", 200],
			"encoding": "listing",
			"value": []
		},
		{ "method": "gh.repo_get_name_with_owner", "args": [], "value": "measurement/isolated" },
		{ "method": "gh.issue_list_by_label_in_repo", "encoding": "listing", "value": [] },
		{
			"method": "defect.measure_window",
			"value": {
				"days": 14,
				"since": "2026-09-01",
				"defects": 73,
				"enhancements": 100,
				"is_capped": false
			}
		},
		{ "method": "net.measurements", "value": { "growth": {} } },
		{ "method": "resume.paused_issues", "encoding": "set", "value": [] },
		{ "method": "resume.open_pr_issues", "encoding": "set", "value": [] }
	]
}
```

`reads` は指定した読取だけを固定応答に置換する。`args` がある行は引数完全一致、ない行はその読取の全呼出しが対象。`json` は通常のJSON値、`listing` はIssue一覧のJSON応答、`set` はIssue番号文字列の集合に復元する。未指定の読取は本番の読取実装を通る。

未来の開始条件は Issue body の `## 背景` 内に `- 実施可能日: 2999-01-01T00:00Z` と書き、既存labelに `not-before` を含める。label同期が必要な入力はtracker変更の拒否として失敗する。`outcomes` に `{"901":"failed"}` 等を渡すと代替起動の失敗・待機も照合できる。

## warm / cold と実通信

- `cold`: 各反復で新しいプロセス、Git作業領域、状態、cacheを作る。
- `warm`: 一つの隔離プロセスで事前に1回実行し、同じ入力・状態・cacheを保ったまま指定回数を反復する。事前実行は `warmup: true` で集計から除外する。worker記録先は反復ごとに分ける。cacheの期限・入力keyが変わった場合は既存実装どおりmissになるため、生記録のhit/missを併せて読む。

必要なREST読取は `live_get` にGitHub APIの完全な相対endpoint（query stringを含む）を列挙し、対応する固定応答を取り除く。許可endpointへの `gh api` GETだけを通し、pagination、include、jq等の読取用フラグを許可する。GraphQL・tracker書込み・任意のコマンド・実worker起動は拒否する。GraphQLからの読取を集合などの固定応答に置換した場合、その境界は実通信の計測対象に含めない。

## 生記録と比較

標準出力の `root` が成果物の場所。各試行の `input.json`、`status.json`、`startup.jsonl`、`boundaries.json`、`result-N.json` を保存する。`timeout_ms`（既定60秒）を超えた子プロセスは失敗とし、親プロセス自体の中断では開始時の `incomplete` が残る。

`startup.jsonl` は既存startup scope・保存APIの生記録で、run・attempt・Issueに紐付く。`result-N.json` は既存集計APIの結果、候補順、待機理由、driverの状態・拒否結果、境界のsourceを含む。`live` は実プロセス読取、`replay` は固定応答、`replacement` は代替worker動作、`denied` は拒否。API計数は実際の通信経路の計数とし、固定応答の呼出し回数は境界記録で別に数える。Gitの読取も `live` に含まれるため、API回数を境界行数で代用しない。

計測範囲は候補取得・cache・driverの開始判断。予算回答・資源条件は入力で固定し、レーン準備・実workerは代替する。代替workerのphaseは明示して記録する。**この範囲の時間を本番全体の起動時間として扱わない。** root以下にしかNodeのファイル書込みを許可せず、外部プロセスの読取も隔離cwdと許可commandに制限する。失敗、拒否、中断、計測記録欠落の試行を成功サンプルに混ぜない。

## 完全性と warm の由来

`status.json.status` の `completed` は子プロセスの終了状態だけを表す。`measurement_complete` と各 `result-N.json.completeness` を併せて読む。入口の `succeeded` は、予定した全結果が存在し、全試行が `normal` または意図した `waiting` の場合だけtrueになる。

- `normal`: 必要な工程が終了し、読取欠測・検索上限・不完全なwarmupの継承がない。`normal_sample: true`。
- `degraded`: 外側の選定は継続したが、子工程failed、必要な不具合率の欠測、または読取結果の `is_capped: true` がある。
- `failed`: 外側の選定または代替起動が失敗した。
- `waiting`: 正常な選定の後、入力で指定した資源・開始条件により起動を待つ。正常起動時間の標本には数えない。
- `incomplete`: 工程の終了記録がない、またはstartup記録自体がない。親の中断では従来どおり開始時のstatusが残る。

`reasons` は子工程・読取の不完全性を示す。`observation` 境界は読取結果の検査であり、通信回数でも固定応答の追加呼出しでもない。warmの後続結果は `warmup_origin` に事前実行のattemptを保存する。不完全なwarmupの理由は、後続がcache hit・API0でも継承する。この群全体を保守的に除外し、途中のcache失効・再取得だけでは独立した正常群へ昇格させない。本番cacheの保存条件やフォールバックは既存実装のまま。

許可した実GETの失敗は境界の `failure`、`http_status`、`response_reason` に保存する。`endpoint_index` は入力の `live_get` の0始まりの位置（未登録は-1）。応答本文・エラー文・アカウント情報は保存せず、既知の応答理由だけを固定文言へ分類する。`unreported` は理由または状態が取得できなかったことを示し、403だけでレート制限と推測しない。startupのAPI計数はretryを含む実呼出しの試行回数であり、HTTP失敗境界数、検索欠測、取得成功数とは別である。

## 同じ条件での実通信標本

候補901〜906とその依存、開始条件、空き枠、検索query・日付・pageを固定した元入力を保持する。候補一覧・依存などをreplayし、計測対象の不具合率GETだけを実通信にすれば、候補集合を変えずに対象読取を測れる。ただしGitHub上の検索母集団は固定できず、同じqueryでも後続の更新や取得上限で不完全になり得る。正常系を採用するには対象の全検索が成功し、`is_capped: false` であり、coldの独立試行とwarmの事前実行・全反復が完全であることを毎回確認する。全replay群は実通信baselineへ混ぜない。

2026-11-13、#7423 の保存済み `live-one-cold` / `live-one-warm` / `live-multiple-cold` / `live-multiple-warm` 入力をそのまま隔離入口で再実行した。coldは各3回、warmは事前実行と各5回。検索上限またはHTTP403による欠測と、そのwarm由来の継承により、4群とも正常系 **n=0**。実GETが成功した試行も検索上限を理由に除外した。許可したGETの取得条件を満たせる証拠は得られておらず、性能比較は未成立である。元入力と成果物はローカルのgit共通ディレクトリ配下 `josh/measurements/7460-completeness/` に保持する。本番ラン操作や検索範囲の変更で代用しない。
