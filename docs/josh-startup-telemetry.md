# backlog 起動区間の計測

起動計測は既存の lane ledger に `kind: startup` として追記する。保存先は
`lane_ledger.target()` / `target_of(repository)` で求める common git directory 配下の永続 JSONL。
イベントストリームの削除・間引きはこの台帳を変更しない。書込みには既存の所有権確認・
O_APPEND・O_NOFOLLOW を使い、ship lap と子プロセスへの scope 継承を共用する。

`lane_ledger.read_entries(path)` から `kind === 'startup'` を抽出し、
`run_startup_store.summarize(rows)` で区間別の時間・状態・API/cache 計数を読み出す。
`concurrent_misses(rows)` は同じキーの fill が重なった miss を返す。最初の miss も
後から並行になり得るため、全記録の時間区間を比較する。待合せや重複排除は追加しない。

- `run`: repository と carry の開始日時。同じ run の再開は同じ値になる。
- `attempt`: 新しい offer・launch・初期化呼出しごとの UUID。子区間と子コマンドへ継承する。
- `issue`: 判明している場合の Issue 番号。
- `id` / `parent`: 区間 UUID と親区間 UUID。並行 launch は別の区間になる。
- `phase`: 初期化、候補取得、条件判定、適格性、不具合率、測定、分割判定、レーン作成、
  インストールの資源待ち、インストール実行、再インストール、worker dispatch。
- `edge`: start・done・failed・waiting、または API/cache の観測。
- `elapsed_ms`: 終端にのみ単調時計の経過時間を記録する。親は子の時間を含むため加算しない。
- `api`: 共通 gh spawn 計数点の REST・GraphQL・その他 gh・無料エンドポイントを区別する。
  retry は別呼出し、paginate は CLI の一 spawn。HTTP ページ数や課金数とは区別する。
- `cache`: shared cache の hit・miss と fill。キーは slot と検索キーのハッシュのみ保存する。
  shared cache を通さないメモリキャッシュは対象外。

失敗を値で返す起動処理は failed、資源が空くまで起動しない回答は waiting として記録する。
例外も failed になる。start だけで終わった区間は incomplete、時間は未確定のまま残す。
失敗・待機・未完了を成功時間やゼロ秒に置き換えない。

計測は best effort。run の識別、保存先の解決、追記に失敗した記録は欠測となり、
元の処理の結果・例外を変えない。候補順、信頼検証、所有権確認、起動回数に介入しない。
記録は成功判定や起動条件に使わない。実測ベースラインと高速化は後続 Issue の対象。
