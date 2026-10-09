## Step 1: Issue 作成テンプレ

タイトルは簡潔で明瞭な英語で記載する（「出力の言語（`JOSH_SESSION_LANG`）」の例外）。日本語のタイトルや改善できる英語のタイトルは、実装開始前に書き換え、`gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f title="<title>"` で GitHub 側も合わせる。本文は次の最小テンプレートの節をすべて含める:

````md
## 背景

<不具合なら `- 種別: 不具合`、そうでなければ `- 種別: 非不具合` を宣言する>

<なぜ必要か>

## 現象

<現在の問題>

## 期待結果

<どうなれば完了か>

## 受け入れ条件

- [ ] 条件1
- [ ] 条件2

## 発火点

<AI の振る舞いを変える Issue のみ。その規則が破れる瞬間に最初に呼ばれるツールコール名を 1 つだけ書く（例 `Bash` / `Edit` / `Read` / `Write` / `AskUserQuestion`）>

## ベースライン

<AI の振る舞いを変える Issue のみ。「コマンド + 値」で書く>

- `<測定コマンド>` → <現在の値>

## 再現

<AI の振る舞いを変える Issue のみ。「コマンド + 実際の出力」で書き、出力はフェンス（``` または ~~~）で囲む>

- `<再現コマンド>`

```
<実際の出力>
```

## Origin

<別リポジトリのセッションから起票した場合のみ。起票元 Issue を `owner/repo#N` 形式で書く。自リポジトリ発の Issue では節ごと省略する>
````

### `## 背景` 直下の宣言と分類ラベル

起票は `pnpm josh issue:file "<title>" --body-file <本文ファイル> --depth <n>` で行う。本文の検査（`pnpm josh issue:lint <path>` と同じ）と、下表の宣言から決まる分類ラベルの付与は、このコマンドが 1 回の作成リクエストで行う。**宣言を選ぶのは起票者の判断であり、コマンドは単語から推測しない。**

| 宣言                   | 付くラベル        | 選ぶ基準                                                                                   |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| `- 種別: 不具合`       | `bug`             | 報告された症状を直す。`- 種別: 非不具合` とどちらか一方を必ず置く                          |
| `- 目的: 機能追加`     | `enhancement`     | 新しい機能。不具合修正・文書のみ・依存更新・保守作業には書かない                           |
| `- 目的: 機能改善`     | `enhancement`     | 既存機能の改善。目的が曖昧なら期待結果と受け入れ条件を具体化してから選ぶ                   |
| `- 互換性: 破壊的変更` | `breaking-change` | 既存の利用者・API・設定の契約を変える。移行措置があっても書き、廃止対象と影響を説明する    |
| `- 種別: 振る舞い変更` | なし              | AI の振る舞いを変える。`## 発火点` / `## ベースライン` / `## 再現` の 3 見出しが必須になる |

- **持ち主の意図と違う動きは、コード・コメント・テストに書かれた設計どおりでも `- 種別: 不具合` とする。** コードは意図を写したもので、意図そのものではない。変更の形（コードか文書か）でも決めない。例: コメントとテストに固定されたまま意図より広く働く自動付与、文書だけでも意図と違う分類を生む基準
- **`- 種別: 不具合` の Issue の回帰テストは、利用者が症状を見たのと同じ粒度で書く。** 修正前のツリーでも緑になるテストは `pnpm josh git -y` がコミットを拒否する（joshuafolkken/kit#2448）
- **`bugfix` は PR のリリース分類であり、Issue の `bug` の代わりにしない。** `enhancement` と `breaking-change` の両方を持つ Issue の PR は `breaking-change` 一つに分類する
- **`## 発火点`** の名前は `prompts/collaboration-workflow/rule-delivery.md` の配送表と突き合わされる
- **`## ベースライン`** の測定コマンドは、マージ後に `pnpm josh measure:rerun <N>` が再実行して before / after を印字する（作者が `OWNER` / `MEMBER` / `COLLABORATOR` の Issue に限る）
- **公開しないと利用側が使えない変更には `--release` を付ける**（既存 Issue は `pnpm josh issue:release <N>`）。リリース用 Issue の blocker になる（`docs/josh-commands-backlog.md` → `josh issue:release`）

### 起票元へのバックリンク（`## Origin` / `## Upstream issues`）

**別リポジトリのセッションから起票した Issue には、起票元へのリンクを双方向で必ず書く。** 欠陥がどのプロジェクトでどう現れたかの証拠は起票元にしかない。

| 方向                  | 置き場所                      | 固定見出し              | 内容                                                 |
| --------------------- | ----------------------------- | ----------------------- | ---------------------------------------------------- |
| 上流 Issue → 起票元   | 上流 Issue の本文             | `## Origin`             | 起票元 Issue（`owner/repo#N` または URL）            |
| 起票元 Issue → 上流   | 起票元 Issue の本文かコメント | `## Upstream issues`    | そこから起票した上流 Issue を全件列挙する            |
| 起票元 Issue → 未起票 | 起票元 Issue の本文かコメント | `## Upstream candidate` | 第三者リポジトリへ報告する候補（**未起票**）と下書き |

- **見出しは固定する**（grep で見つかるように）。起票元の本文が確定済みなら、同じ見出しでコメントに書く
- **リンクは必ずリポジトリ修飾する**（`owner/repo#N` または完全 URL）。裸の `#N` は上流側で別 Issue に解決される
- **チェックボックス行（`- [ ] owner/repo#N`）で書かない。** 散文か素の箇条書き（`- owner/repo#N`）にする — チェックボックス付きの他リポジトリ参照は epic の自動クローズを止める
- **未起票の候補は `## Upstream candidate` に置く。** third-party への報告はユーザーの明示指示まで起票しない（→「第三者リポジトリへの書き込みは Tier C（明示指示が必要）」）
- 割り込みで起票する手順は `upstream-interrupt.md`

### 複数 Issue に分割するときの epic Issue

**1 つの要望を 2 件以上の Issue に分割したら、件数や順序の有無にかかわらず常に epic を作る。** 分割の設計図を、最初にクローズされる子 Issue ではなく閉じない置き場に残すためである。作成は `pnpm josh epic`、点検は `pnpm josh epic:check <E>`、子の追加は `pnpm josh epic --add` で行い、本文を手で編集しない。epic 自体を実装ランに渡さない（`backlogrun #<E> --only` が子を回す）。コマンドと本文の記法は `epic-commands` スキル →「Creating an epic」。

**`josh` が使えない環境での手作業手順:**

1. 子 Issue をすべて起票し、番号を控える。
2. ラベルを用意する: `gh api repos/{owner}/{repo}/labels -f name=epic -f color=5319e7 -f description="Tracks a batch of child issues from one split" --silent 2>/dev/null || true`
3. epic を作り、`id` ではなく **number** を控える: `gh api repos/{owner}/{repo}/issues -f title="<epic-title>" -f 'labels[]=epic' -F body=@<body-file> --jq .number`。本文は次の形にする（順序がなければ `Dependencies` に `None — the children are independent; any execution order works.` と書く）:

   ```md
   ## Split rationale

   <why this split>

   ## Dependencies

   #101 -> #102

   ## Execution

   backlogrun #<E> --only

   ## Progress

   - [ ] #101 <title>
   - [ ] #102 <title>
   ```

4. 順序があるときだけ、別ステップで依存を足す（Issue 番号ではなく database id を渡す）: `gh api repos/{owner}/{repo}/issues/<N2>/dependencies/blocked_by -F issue_id="$(gh api repos/{owner}/{repo}/issues/<N1> --jq .id)"`

各手順の理由と経緯は kit の `docs/maintainers/epic-commands-rationale.md` →「Creating an epic by hand」。
