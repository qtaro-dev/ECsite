# T46 GitHub Actions・Vercel・SupabaseのCI/CD

**公開MVPの最新環境判断**：利用者承認の[単一Hosted DB運用](../docs/mvp-hosting-decision-2026-09-28.md)を適用する。以下の別Supabaseプロジェクト前提は後日拡張として扱い、今回の検証では1件を順次利用する。公開後のPR Previewに公開DBの秘密を渡さない。

**状態**：未着手  
**フェーズ**：M7 品質・CI/CD・公開  
**推奨実装順**：47/49（番号順ではなく[実装計画](../docs/implementation-plan.md)第3章の順序）
**一覧へ戻る**：[implementation-tickets.md](../docs/implementation-tickets.md)

**公開MVPでの追加設定**：[単一Hosted DB運用](../docs/mvp-hosting-decision-2026-09-28.md)と[公開MVP計画](../docs/mvp-release-plan.md)に従い、検証中は固定Vercel Previewだけを単一Hosted Supabaseへ接続する。Productionへ切り替える際は未完了注文・Webhookを照合し、Hosted接続を順次移す。PRごとのPreviewにはHosted DB資格情報を渡さず、ActionsのローカルSupabaseでDB/RLS試験を行う。匿名Auth、レート制限、T50/T51のRLSと架空データを検証し、Productionの認証省略を有効にしない。

**2026-09-29の監査更新**：GitHub mainはactive ruleset `main protection`でPR必須となり、required checks `Quality gates`と`Catalog UI browser tests`が設定済みであることを公開APIで確認した。required approvalsは0。Vercel固定Preview aliasは古い`f6d055a`基準で、新しいdeploymentへの更新が必要。Preview envの8変数（`ANON_CART_SIGNING_KEY`、`STRIPE_SECRET_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`AUTH_BYPASS_ENABLED`、`SMS_DELIVERY_MODE`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SITE_URL`）はすべて`codex/mvp-demo-preview` branch scopeにあり、これらのgeneric Preview entryは0件と確認済み。値はこの記録に含めない。deploymentへの反映とHosted Supabase疎通は未確認。Productionは最新main基準のReady deploymentがあるがProduction環境変数一覧は空で、稼働確認済みとは扱わない。Preview ProtectionはSSOリダイレクトが有効だが、方式変更はユーザー判断待ち。T49用の`STRIPE_WEBHOOK_SECRET`、`INTERNAL_JOB_SECRET`、`T22_INTERNAL_JOB_SECRET`は未確認で、Webhook/Cron接続も未完了。

## 目的

レビューと環境分離を保って公開できるようにする。

## 対応要件ID

| ID | 要件定義書の要件 |
| --- | --- |
| QLT-01 | 主要操作、異常系、権限、在庫・金額の整合性について受け入れ条件を作る。 |
| SEC-01 | テスト用の認証省略機能と管理権限を公開環境の一般利用者に開放しない。 |
| SEC-02 | 公開デモの模擬SMSとDevelopment/Testの認証省略は別機能とする。模擬SMSでもコードの照合を必須とし、省略設定を本番環境で有効にできない。 |

要件定義書の「詳細化待ち」および古い確認待ち表記は、後続の利用者承認と詳細設計の確定内容を適用する。

## 参照する設計箇所

- [要件定義書（正本）](../output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf)：上記3件の要件ID。
- [基本設計書](../output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf)：§2、§12。
- [詳細設計書](../output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf)：§11、§12、§13。
- [詳細設計の編集原稿](../docs/detailed-design-review.md)：同章の表・状態・例外・画面IDを実装時に確認する。
- [実装計画](../docs/implementation-plan.md)・[AGENTS.md](../AGENTS.md)：作業順序と共通ガードレール。

## 依存チケット

- [T05 CIの最小ゲート](T05-ci-baseline.md)
- [T45 全体E2Eと性能検収](T45-full-e2e-performance.md)
- **外部作業ゲート**：G-GitHub/G-Vercel/G-Supabase。接続・認証・費用が必要な段階で利用者へ具体的に提示する。

## 対象範囲

- GitHub Actions、Vercel Git連携、単一Hosted Supabaseの検証・提示間の順次切替。

## 実装内容

- 既存のCI（quality、catalog-e2e、path-filtered DB integration）を確認し、PRの必須チェックとしてmainを保護する。Actionsでは隔離したローカルSupabaseを使い、Vercel Git連携にWebデプロイを任せる。Actionsから二重デプロイしない。
- 検証中は固定Vercel Previewだけに必要なHosted接続情報を限定し、ProductionはHosted DBへ接続しない。提示用へ切替後はProductionのみを接続し、以後のPR PreviewからHosted秘密を外す。DBマイグレーションは対象Project Refと履歴を照合して監督付きで適用し、失敗時のアプリ復旧手順を記録する。
- T49へ引き渡す固定Previewの実URL、Supabase Project Refと適用済みmigration、StripeテストWebhookの受信先、必要な環境変数名を整理する。実通知確認はT49で行う。秘密値を文書やログへ記録しない。
- 入出力・DB・権限・画面に変更がある場合は、同じチケット内で対応するOpenAPI、Zod、マイグレーション、RLS、テスト、文書を整合させる。

## 対象外

- Actionsからの二重Vercelデプロイ、無承認の有料プラン。
- 他チケットの機能と、正本にない仕様の独断追加。必要なら変更案を報告する。

## 受け入れ条件

- 検証中にHosted Supabaseへ接続するのは固定Previewだけであり、Productionは同時接続しない。切替後はProductionだけが接続し、PRごとのPreviewにはHosted DB/サービスロール/Stripe Webhook/内部ジョブの資格情報を渡さない。
- `main`で必要なCI status checksが必須となり、失敗時にmergeできない。Productionの決済鍵はStripeテスト鍵のみであることを確認する。
- 設計との不整合、秘密・個人情報の露出、権限の迂回がない。外部設定が未完了なら接続確認を完了扱いにしない。

## 必要なテスト

- PR PreviewがHosted資格情報を受け取らないこと、固定Previewの該当branchへの資格情報の範囲、mainのテストデプロイを確認する。
- 単一Hosted Supabaseを固定PreviewからProductionへ順次切替する環境変数差分、migration履歴と適用順、Webhook/Cron先、復旧・再接続手順を演習する。
- 該当する境界・異常・権限のケースを実行し、既存の関連回帰テストも通す。実行できない場合は理由を記録する。

## 完了条件

- 対象範囲の成果物と受け入れ条件が揃い、指定テストの結果を記録した。
- チケット外の変更、設計上の疑問、外部作業の未完了を隠さず報告した。
- 変更点、設計根拠、テスト結果、残課題をLUNAの完了報告に記載し、レビュー可能な差分になっている。
