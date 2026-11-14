# 観測条件が未達の調査を再開する

調査で不足が判明したら、書き込み権限を持つ調査担当者が、同じ Issue のコメントに必要な証拠をチェックリストで記録する。

```markdown
## Observation evidence

- [ ] multi-slot: code 以外も含む複数レビュー slot の brief と処置実例
- [ ] same-head: 同じ HEAD のレビュー先行 push・gate・Actions・全レビュー証明
- [ ] comparison: 比較可能な対照と処置結果
- [ ] cost: 取得済みの比較費用
```

Issue 本文へ、実際のコメント URL と必須キーを次の形式で追加する。コメントの自由文や終了メッセージだけでは観測待ちに分類されない。

```markdown
<!-- josh:observation-wait:v1 https://github.com/OWNER/REPO/issues/7400#issuecomment-123 multi-slot,same-head,comparison,cost -->
```

本文とコメントが待機条件の永続記録となる。終了処理は既存の待機経路でレーンを解放し、失敗回数を増やさない。選択処理と board も同じ条件を使う。board は待機中の Issue を waiting 欄に置き、不足しているキーを表示する。その理由の文字列は、端末では証拠コメントへのリンクになる（`--chat` のようにパイプへ出す出力は、他のリンクと同様にリンクを付けない）。`run:add --retry` で積んだ未起動の Issue も、計画が到達させない（待機中の）ものは lanes 欄に出さず waiting 欄に置く。計画が次に起動するものは lanes 欄に残る。

必要な実例を lane ledger が記録する条件なら、宣言の末尾に ledger 条件を足せる。条件を満たした時点で、証拠コメントのチェックを待たずに次の選択から再観測できる。満たすまでは従来どおり待ちとして保持し、失敗に数えない。

```markdown
<!-- josh:observation-wait:v1 https://github.com/OWNER/REPO/issues/7400#issuecomment-123 multi-slot,same-head,comparison,cost ledger:multi-slot-early-push>=1 -->
```

`multi-slot-early-push` は、レビューの slot が 2 つ以上あるラウンドで、先行 push が成功（`pushed`）した early-push 記録の件数である。early-push 記録は対象の HEAD（`head`）とレビューの slot 数（`slots`）を持つ。`slots` の無い過去の記録は数えない。未知の指標名は未知の宣言形式として待機を維持する。ledger を読めない checkout では件数を 0 とする。

証拠が得られた条件だけをチェックし、その行に GitHub の証拠リンクを付ける（例: `- [x] cost: 比較費用 [evidence](https://github.com/OWNER/REPO/issues/7400#issuecomment-456)`）。全必須キーが一意に存在し、チェック済みかつ証拠リンク付きになったとき、次の選択から再観測できる。担当者が証拠の内容を確認したという記録であり、リンクだけで測定結果を自動解釈する機能ではない。

マージ数の増加、code slot だけの先行 push、費用の未取得は、上記条件を充足しない。必要な条件を削除して再開してはいけない。コメントからのキー削除・重複、未チェック、証拠リンク不足、未知の宣言形式、取得失敗、書き込み権限を確認できない作者は待機を維持する。充足済みコメントも毎回再取得し、再起動後も本文から再判定する。通常の機械的失敗や人の判断待ちの分類は既存のまま扱う。
