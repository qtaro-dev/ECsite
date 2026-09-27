# T49 公開テスト環境でのStripe Webhook接続・実通知検証

**公開MVPの検証対象**：[公開MVP計画](../docs/mvp-release-plan.md)のT50/T51デモ会員と架空データによる実Stripeテスト通知を使用する。実住所・実メール・ライブ決済鍵を使わず、Hosted Checkoutが求める入力項目も確認する。

**状態**：未着手

**フェーズ**：M7 品質・CI/CD・公開 / F7 W36

**推奨実装順**：48/49（T46の環境分離・Previewデプロイ後、T47の公開判断前）

**担当**：LUNA-A
**一覧へ戻る**：[implementation-tickets.md](../docs/implementation-tickets.md)

## 目的

T31で実装した署名検証・決済状態更新を、Vercel Preview、専用Supabase Preview、Stripe**テストモード**を接続した公開テスト環境で実通知により確認する。ローカルDocker Desktop、ローカルSupabase、Stripe CLIを前提にしない。テスト環境を一般向けポートフォリオのProductionと混同しない。

## 対応要件ID

| ID | 要件・根拠 |
| --- | --- |
| ORD-07 | 決済成功・失敗と利用者への次の操作を検証する。 |
| ORD-08 | 決済、注文、送料・税、在庫の状態遷移を検証する。 |
| INV-02 | 成功時の引当消費と失敗・期限切れ時の解放を確認する。 |
| INV-03 | 重複・遅延通知で在庫が二重更新されないことを確認する。 |
| SEC-01 | 署名、秘密、管理権限、Preview/Production分離を守る。 |
| QLT-01 | 公開環境で再現できる検証証拠を残す。 |
| USR-STRIPE-01 | 2026-09-27の利用者指示。実Stripe通知はローカルではなくVercel/Supabase/Stripeテストモードを接続した公開テスト環境で確認する。 |

## 参照する設計箇所

- [要件定義書（正本）](../output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf)：ORD-07、ORD-08、INV-02、INV-03、SEC-01、QLT-01。
- [基本設計書](../output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf)：§9、§10、§12。
- [詳細設計書](../output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf)／[編集原稿](../docs/detailed-design-review.md)：§6、§9、§11–13。
- [T31 Webhook実装](T31-stripe-webhook-state.md)、[T46 環境分離とCI/CD](T46-cicd-vercel-supabase-release.md)、[環境構築手順](../docs/environment-setup.md)、[AGENTS.md](../AGENTS.md)。

## 依存チケット・開始条件

- [T31 Stripe Webhookと決済状態](T31-stripe-webhook-state.md) がコード・自動テスト・レビュー・マージまで完了している。
- [T32 期限切れ照合と補償ジョブ](T32-payment-expiry-reconciliation.md) が完了している。
- [T46 GitHub Actions・Vercel・SupabaseのCI/CD](T46-cicd-vercel-supabase-release.md) で分離したPreview URL、Supabase Preview、版管理済みマイグレーション適用手順が使用可能である。
- **外部作業ゲート G-Stripe/G-Vercel/G-Supabase**：本人のアカウント作成・連携許可・認証、費用または公開範囲の判断が必要になる時点で具体的に確認する。既存権限で安全に戻せるWebhook登録・テスト設定・検証・片付けは自律的に行う。秘密の値は開示しない。

## 対象範囲

- 公開テスト用Preview環境の接続確認、StripeテストモードWebhookエンドポイントの登録・署名秘密の設定、実通知の受信とDB状態の検証。
- 検証用の架空商品・架空会員・架空配送先、テスト決済、イベント証拠と安全な片付け手順。
- 設定手順と検証結果の記録。実装不具合が見つかった場合はT49の範囲で修正できるものだけ対応し、設計変更は報告する。

## 実施内容

1. T46のPreview環境を確認する。Vercel Previewの実URL、専用Supabase PreviewのProject Ref、マイグレーション版、RLS、Storage、環境変数の**設定有無のみ**を確認する。ProductionのDB・鍵・実個人情報を流用しない。
2. Stripe Dashboardの**テストモード**で、対象Previewの正確な `https://<preview-host>/api/webhooks/stripe` をWebhook宛先として登録し、T31が受けるイベント種別を設定する。Preview URL変更時は宛先を再確認する。Vercelのアクセス保護が通知を遮る場合は、無料プランで実現可能な設定と公開範囲を確認し、費用・公開範囲の変更が必要なら利用者判断を待つ。
3. Stripeテスト秘密鍵と、そのWebhook宛先固有の `whsec_` 署名秘密をVercel **Preview専用**秘密として登録する。Supabaseのservice role鍵等も同じ環境だけに設定する。鍵の値をGit、PR、ログ、ブラウザ、進捗HTMLへ書かない。ライブ鍵を拒否する既存検査を維持する。
4. 架空データで会員注文からStripe Checkoutテスト決済まで実行し、Stripe Dashboardの配信履歴、VercelのHTTP応答、Supabaseの注文・決済試行・イベント・引当・在庫を突合する。成功は署名済み通知後だけ`paid`となることを確認する。
5. テストモードの失敗経路、同一イベントの再送、逆順・遅延、無効署名、異額・不一致、DB/API障害時の再試行を、Stripe側から実施可能な操作と安全な合成リクエストに分けて確認する。Dashboardで再送できないケースはCIの署名付きテスト・DB統合テストを証拠として明示し、「実通知で確認済み」と混同しない。
6. 署名秘密の誤設定・未設定は拒否、重複は二重消費・二重解放なし、失敗・期限切れは引当解放、条件を満たす期限後成功だけ原子的に在庫消費、満たさない場合は要確認となることを記録する。Webhook応答失敗の調査と再送手順、秘密ローテーション、テストデータ削除を文書化する。

## 対象外

- Stripeライブ決済、実課金、実商品発送、Production上の個人情報を使う試験。
- ローカルDocker Desktop・Stripe CLIを前提にした環境構築。
- Vercel/Supabase/Stripeの有料プラン契約や、利用者に無断の公開範囲変更。
- T31の既存仕様を独断で変更すること。新たな設計矛盾は根拠・影響・選択肢を報告する。

## 受け入れ条件

- 実在するVercel Preview URLへStripe**テストモードの実通知**が届き、署名確認後に処理される。Stripe Dashboardの配信結果、Vercel応答、Supabaseの状態が同一テスト注文で対応づく。
- テスト決済成功・失敗を確認し、成功前に戻りURLだけで`paid`へ進まない。在庫の消費・解放、イベント重複排除がDB上で検証できる。
- 無効署名、再送、逆順、遅延、不一致、処理失敗の扱いを検証し、実通知で実施した範囲と合成/CIで実施した範囲を区別して記録する。
- PreviewはProductionとSupabase Project、Stripe Webhook秘密、データを共有せず、Stripeライブ鍵・実個人情報・実課金を使わない。
- 証拠は日時、環境識別子、イベントIDの必要最小限、結果と再現手順のみを残し、秘密・住所・電話・メール本文を含めない。

## 必要なテスト

- PreviewでのテストCheckout成功・失敗と実Webhook配送、DB状態突合、戻りURLだけでは未確定の確認。
- Stripe Dashboard再送による同一イベントの重複、署名不正、対象外イベント、逆順・期限後成功、在庫競合・異額の安全な確認。実通知で再現できない条件はT31/T32のCI証拠で補完し、その区別を記録する。
- Preview/Productionの環境変数・接続先・Webhook宛先の分離、RLS、秘密漏えい、失敗後復旧の確認。

## 完了条件

- 受け入れ条件を満たし、実Stripeテスト通知を伴う検証証拠と実施不能ケースのCI証拠をレビュー可能な形で記録した。
- 外部設定が未了、費用・公開範囲の判断待ち、実通知未着のいずれかなら未完了とする。
- 変更点、テスト結果、PR/commit、未解決事項、外部設定・運用引継ぎを報告し、T47に結果を渡す。
