# T44 公開MVPセキュリティ監査結果

**判定：部分完了。T44全体は未完了。** 初回のヘッダー監査はe26de50を基準とし、この追補は79f0924以降で確認した自動検証を記録する。Hosted DBのDDL・設定は変更していない。

## 実装したヘッダー

`next.config.ts` で全パスに `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy` を設定した。CSPは `base-uri 'self'`、`object-src 'none'`、`frame-ancestors 'none'`、`form-action 'self'` の範囲に留めた。HSTSはProduction buildだけに `max-age=31536000` を付け、共有 `vercel.app` サブドメインへ影響する `includeSubDomains` は指定していない。

`script-src` と `default-src` は未設定であり、CSP全体を満たしたとは扱わない。Nextのnonce方式は静的レンダリングを動的化する影響があるため採用しなかった。Production buildで `/`、`/search`、`/verify` が静的出力のままであることを確認した。Stripe Checkoutは外部ページへの全画面遷移で、アプリ内Stripe script/iframeは使っていない。ブラウザーSupabase Authは設定済みSupabase URLへ接続する。

## 既存の境界テスト証拠

- `tests/database/t50-demo-auth-rls.sql`：匿名デモ会員間の住所・カート分離、デモ会員の管理者拒否、自己昇格拒否。
- `tests/database/t51-demo-address-rls.sql`：デモ会員の架空住所制約と通常会員の住所操作。
- `tests/database/t22-demo-retention.sql`：30日境界、通常会員除外、決済・引当保留、再試行、削除キュー権限と署名検証。
- `tests/server/auth.test.ts`、`tests/server/admin-authorization.test.ts`：Productionで認証バイパス拒否、匿名ユーザーの管理API拒否とfail-closed。
- `tests/server/demo-retention.test.ts`、`tests/server/demo-delete-route.test.ts`、`tests/server/demo-retention-cron-route.test.ts`：削除期限、越権要求、署名検証。
- T09/T10のDBテストは公開表のRLS、所有者アクセス、自己昇格拒否、公開商品限定を検証する。

これらのSQL統合テストは本作業中に再実行していない。Supabase CLIとDockerがこの作業環境で利用できず、Hosted DBには接続しない方針のため。既存Vitestは再実行した。

## 秘密、保持、残課題

- 初回の手動走査はtracked working treeを対象に、Stripe live key、AWS key、GitHub token、Supabase secret key、PEM private keyのパターンを値を表示せず確認し、該当なし。網羅的スキャンではなく、Gitleaks CLI取得は当時のTLS認証失敗で実行できなかった。
- CIのQuality gatesへGitleaks CLI v8.30.1のフルGit履歴スキャンを追加した。公式Linux x64 archiveのSHA-256を検証し、`--redact`を指定する。追加のGitHub token/権限を使わない。初回のCI実行結果は未確認であり、過去履歴の誤検知を含めてPR CIで確認する。
- 初回のCI走査で`generic-api-key`が6件検出された。ログから値を採取せず該当ソースを調べ、保持migration内のVault secret名参照・検証式、T22 SQLの合成Cron secret fixture、Stripeテスト内の合成idempotency fixtureと確認した。実資格情報の埋込みは確認されなかった。`.gitleaksignore`には該当する6 fingerprintだけを登録した。除外根拠はこの段落と対応ファイル・行に限定し、パスやルール全体は除外していない。PR CIの再実行で除外の動作と残りの全履歴を確認する。
- Productionで`AUTH_BYPASS_ENABLED=true`を拒否するVitestはQuality gatesのunit testで実行される。Stripeクライアントのテスト鍵専用チェックとlive Checkout応答拒否も同じunit testで実行される。
- T50/T51の匿名会員RLS・管理拒否とT22の30日保持DB統合テストは`.github/workflows/t06-db.yml`に含まれ、対象migration/DB testの変更時にローカルSupabaseで実行される。これらのDBテストは今回再実行していない。
- Hosted Supabaseのバックアップ保持・復元可能期間は未確認。T22のCron Vault secretも未設定の報告があり、30日削除のHosted実行・本人削除・失敗再試行は未確認。保持要件の合格根拠にしない。
- Hosted Supabase Authのレート制限設定は未確認。アプリの正式見積APIにはユーザー単位のDBレート制限テストがあるが、Auth endpointの外部IP制限を代替しない。
- 一般向けGoogle OAuth、SMTP確認メール、SMS認証、通知メール、SMTP管理は公開後範囲であり、T44の完了対象として表示しない。

## 実行結果

- `npm test`：47 test files、232 tests passed。
- `npm run typecheck`：passed。
- `npm run build`：passed。静的ルート3件を維持。
- `npm run lint`：exit 0。既存 `src/lib/schemas.ts` の `_cause` 未使用警告1件。
- `npm ci`：408 packages、npm auditで0 vulnerabilities。
- 新規 `tests/config/security-headers.test.ts`：2 tests passed。

この部分差分のレビュー・マージだけではT44を完了扱いにしない。新規Gitleaks CI結果、Hosted保持/Vaultと削除フローの確認、DB統合テスト再実行、設計書が求めるCSPのスクリプト制御方式の決定・実装が残る。
