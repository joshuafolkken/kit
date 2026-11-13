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

不具合率の検索は、1000件超のときだけ元の `created:>=` / `closed:>=` 期間を秒単位の互いに重ならない区間へ分割する。最後の区間には上限を設けず、元の母集団を保つ。各区間は100件/page、最大1000件を取得し、一つの元検索あたり最大15区間（分割前の検索を含む）を読む。1000件超の区間では最初のpageだけを読み、再試行はしない。HTTP失敗は欠測、不完全応答・件数不一致・重複・分割予算切れ・秒単位でも上限超過は `is_capped: true` のまま正常群から除外する。

再測定には保存済み入力のコピーを新しい隔離入口で使い、候補・依存・資源条件・元query・開始日を保持する。分割の基準日は集計時刻のUTC日付で、同じUTC日内は固定される。cold/warm間で基準日を揃え、各区間の完全一致endpointとpageを `live_get` に追加する。許可リストにない区間は従来どおり拒否されるため、その試行を正常標本には採用しない。必要な検索API予算が回復し、全区間・全pageが成功し、元検索の件数と重複のない和集合が一致した場合だけ正常な実通信反復へ戻れる。現行live runの入力・状態・起動には触れず、正常判定と外部書込み拒否は維持する。性能比較と削減秒数の認定は #7423 で行う。秒単位の期間指定は [GitHubの検索仕様](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-when-an-issue-or-pull-request-was-created-or-last-updated) に従う。

候補901〜906とその依存、開始条件、空き枠、検索query・日付・pageを固定した元入力を保持する。候補一覧・依存などをreplayし、計測対象の不具合率GETだけを実通信にすれば、候補集合を変えずに対象読取を測れる。ただしGitHub上の検索母集団は固定できず、同じqueryでも後続の更新や取得上限で不完全になり得る。正常系を採用するには対象の全検索が成功し、`is_capped: false` であり、coldの独立試行とwarmの事前実行・全反復が完全であることを毎回確認する。全replay群は実通信baselineへ混ぜない。

2026-11-13、#7423 の保存済み `live-one-cold` / `live-one-warm` / `live-multiple-cold` / `live-multiple-warm` 入力をそのまま隔離入口で再実行した。coldは各3回、warmは事前実行と各5回。検索上限またはHTTP403による欠測と、そのwarm由来の継承により、4群とも正常系 **n=0**。実GETが成功した試行も検索上限を理由に除外した。許可したGETの取得条件を満たせる証拠は得られておらず、性能比較は未成立である。元入力と成果物はローカルのgit共通ディレクトリ配下 `josh/measurements/7460-completeness/` に保持する。本番ラン操作や検索範囲の変更で代用しない。

## 分割取得後の再計測手順（#7423）

対象は commit `928d1f7813d774b141cf56e30229beaa63bf5d57`。既存の4群の入力を保持し、分割先の完全一致GET許可だけを追加する。候補・依存・開始条件・資源条件・元query・sinceは変更しない。2026-11-13 UTCの最初の分割は2026-11-06T12:00:00Zで、左の終端はその1秒前、右は開区間のまま。各元queryの深さ3まで（15区間）の許可を事前生成する。これより深い分割が必要な試行は許可外として除外する。

coldは群ごとに独立試行3回、warmは正常な事前実行1回と同一プロセス内5回。coldの各呼出しは反復数1とし、群を交互に実行する。検索枠の回復待ちは試行の外側に置き、工程時間へ加算しない。各試行の完全性とwarmの由来を確認してから正常群へ採用する。逐次試行のため同時missの共有効果は測れない。

生記録と元一時rootの対応はgit共通ディレクトリ配下 `josh/measurements/7423-baseline-928d1f7/` に保存する。各群・試行の `scenario.json`、`run.json` と `raw/0/` 以下のinput/status/startup/boundaries/resultを保持する。これはローカル成果物で、公開添付ではない。APIはgh spawn単位、工程時間は親が子を含むため加算しない。固定応答の候補一覧・依存照会と、代替workerは実通信・実起動の性能標本に含めない。

### coldの正常標本

次は中央値 / 最大値（ms）。各群n=3、全試行normal。候補cache・不具合率cacheは各群hit0/miss3/fill3、REST各60回（毎試行filed13 / completed7）。同時missは各0だが逐次条件に限る。

- 単一候補: 親11500.791 / 11722.064、候補cache fill10906.588 / 11214.388、候補一覧1.314 / 1.357、候補適格性10863.676 / 11178.841、不具合率10846.395 / 11165.119、不具合率cache fill10844.781 / 11164.041、eligibility23.695 / 26.633、代替worker（n=3）0.408 / 0.429。
- 複数候補: 親11082.591 / 13858.114、候補cache fill10319.084 / 13276.682、候補一覧1.097 / 1.115、候補適格性10275.970 / 13243.541、不具合率10261.921 / 13230.863、不具合率cache fill10260.335 / 13229.687、eligibility25.698 / 34.130、代替worker（n=6）0.550 / 1.074。

coldの不具合率読取がこの範囲の支配工程。completedの件数化は等価性を検証する後続候補とする。既存の候補共有cacheと重なるcacheの追加は不採用。同時照会共有、待機Issue照会絞込み、起動前Issue情報共有、実レーン準備は、この逐次・固定応答・代替起動の計測から効果を判定できないため採用を保留する。候補数による中央値の差を因果効果とは扱わず、削減秒数は約束しない。

### warm・選定・対照の照合

warmは各n=5、正常な事前実行1回ずつを除外。単一候補の親は中央値12.516 / 最大14.108ms、代替worker（n=5）は0.352 / 0.514ms。複数候補の親は12.009 / 14.132ms、代替worker（n=10）は0.471 / 0.563ms。各群candidate cache hit5/miss0/fill0、REST0、同時miss0。候補cache hitで不具合率等の子工程は実行されず、その時間を0msとは扱わない。事前実行は各REST20回、coldと同じfiled13 / completed7。正常標本16件のREST計120回、事前実行を含む採取全体では160回。

単一候補は901選定・代替起動、902～906は901への依存待機。複数候補は901～905選定、空き枠2で901・902を代替起動。入力6件と出力上限5件を区別する。正常標本はすべてin_flightに重複なし、拒否境界なし。実資源待ち・実レーン準備・実worker起動の標本は0。

保存済み対照入力も各1回再実行した。failed-workerはfailedで起動呼出し1回・stall記録1回、waiting-workerはwaitingで起動呼出し1回、どちらもin_flightは空。memory/capacity/usage待機と未来開始条件はwaitingで起動なし。already-runningは901のみを保持し追加起動なし。1ms timeoutは結果なし・timed_out。これら8件と以前の不完全試行は正常時間の分母に含めない。

元run `f660a273f2e9309a` の開始03:05:33.536Z→offer03:05:51.982Zは18.446秒、child-launch03:06:12.776Zまでは39.240秒。seenは7419/7400/7384/7228/5510/5272/5085、startedは7419で今回の固定入力と異なる。launch start03:05:54.015Z以降をinstall時間とは扱わず、ledger dispatch03:06:12.826Zも別の観測点。今回の親区間とは始終点・分母が異なり、差を改善秒数にしない。元のAPI/cache/install内訳は復元不能。

`summary.json` に全工程の中央値・最大値、標本別API数と選定結果を保存する。中央値は偶数なら中央2値の平均。検証scriptは固定入力との等価性、完全性、warm由来、API計数と通信境界の一致、順序と一意性、8対照の状態を照合する。`manifest.json` に再実行・集計scriptと生記録のSHA-256を保持する。同じqueryでもGitHub母集団とホスト負荷は変化するため、各cold n=3の結果を本番全体の保証には使わない。
