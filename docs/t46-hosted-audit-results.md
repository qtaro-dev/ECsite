# T46 Hosted接続の読み取り監査

**確認日**：2026-09-29  
**対象**：Hosted Supabase `jieyvmrhimiimevfwkkc`、Vercel Preview branch `codex/mvp-demo-preview`  
**範囲**：読み取り確認のみ。DB、環境変数、Protection、Stripe設定は変更していない。秘密値・個人情報は取得・記録していない。

## 確認結果

| 項目 | 読み取りコマンド/照会 | 結果 |
| --- | --- | --- |
| Migration履歴 | Supabase CLI `migration list --linked`（local/remote履歴比較） | Hostedとrepoは25件で一致。最新は`20260928130000_demo_retention`。 |
| 匿名Auth | Auth公開設定`GET /auth/v1/settings`の`external.anonymous_users` | `true`。設定変更はしていない。 |
| 公開商品 | Supabase CLIから取得したlegacy `anon` keyを使った匿名RLS `GET /rest/v1/products?select=id&status=eq.published&deleted_at=is.null` | `published`商品18件を返した。レコードの個人情報は対象外。 |
| 30日削除Cron | `cron.job`からjob name・schedule・activeを選択 | `t22-demo-retention`が15分間隔でactive。 |
| 決済照合Cron | `cron.job`からjob name・schedule・activeを選択 | `t32-payment-reconciliation`が5分間隔でactive。Stripe通知は送っていない。 |
| T22/T32 Cron用Vault設定 | `vault.secrets`から対応する`name`列だけを選択 | T22の`t22_retention_url`、`t22_internal_job_secret`、`t22_vercel_bypass_secret`とT32の`t32_reconciliation_url`、`t32_internal_job_secret`は全5名が0件。値は照会・記録していない。 |
| Vercel Preview | Vercel CLI `inspect <deployment-url>` | 固定PreviewのdeploymentはReady、SHA `ac7c42696c935700b36b7d25263ac605ea8cd30a`。 |

## 未確認

- SSOで保護されたPreviewをブラウザーから開いたときの画面表示、Hosted商品取得、匿名Authの実動作。
- Stripeからの実通知と注文・在庫反映。
- T22/T32 Cronの外部HTTP呼び出し、Retention削除実行、決済照合実行。Cron scheduleはactiveだが、関連Vault名5件が0件のため接続成功とは扱わない。

SSO/Protection bypass、匿名ユーザー作成、Stripe通知、Hosted設定変更はこの監査で実施していない。保護されたPreviewのブラウザー確認には認証が必要な場合があり、Protection方式が決まるまで設定を変更しない。
