## 依存更新（`josh latest`）をいつ回すか

**この規則の単一ソースは [`.claude/skills/workflow-commands/latest-gate.md`](../../.claude/skills/workflow-commands/latest-gate.md) である。** ここに本文を複製しない（「クローン禁止・単一ソース化」の適用。joshuafolkken/kit#1174 のパターン）。

`residency.md` が定めるとおり、手順本体は skill 側に置く。この規則が縛るのはコマンドが起動したあとだけなので、`CLAUDE.md` には常駐しない。

手順書に置かれている内容:

- 発火条件はコマンド（`pnpm josh latest:scope`）が答え、裁量に委ねないこと（`required` なら回す・`skip` なら回さない）
- 判断材料は「このチェックアウトで `josh latest` が最後に完走した時刻」のみであること、記録が無ければ `required` であること
- 記録を書くのは `josh latest` のチェーン自身（最終ステップ）であり、途中で落ちたランは記録を残さないこと
- 窓は 12 時間、`JOSH_LATEST_MAX_AGE_HOURS` で前後に動かせること、正の数以外は既定値に落ちること
- `josh latest` が実際に走ったランでは `dependency-update` skill の手順（両ファイルの overrides と `devEngines`）が従来どおり効くこと
- `git stash` と `git switch main && git pull` はこのゲートの持ち物ではなく、答えに関係なく走ること
- `pnpm audit` の頻度が落ちても脆弱性検知の網は失われないこと（CI の `Security Audit` が必須チェックとして全 PR で走る）
- バッチ先頭 1 回ではなく経過時間の窓にした理由（単発の `fullrun` は自分自身がバッチ先頭であり、条件として意味を持たなかった）
