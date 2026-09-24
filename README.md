# 自作PCパーツECサイト

自作PC初心者にも選びやすく、経験者にも探しやすいパーツ専門ECサイトのポートフォリオプロジェクトです。商品選択から注文・決済完了までの体験を、バックエンドを含めて段階的に実装します。**実際の商品販売・課金・発送は行いません。**

現在はT01の最小アプリのみです。商品、会員、注文、決済、管理画面などの製品機能は後続チケットで実装します。

## 設計資料と作業単位

- [要件定義書（正本）](output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf)
- [基本設計書](output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf)
- [詳細設計書](output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf)と[編集原稿](docs/detailed-design-review.md)
- [実装計画](docs/implementation-plan.md)、[47件のチケット索引](docs/implementation-tickets.md)、[担当割当・実行計画](docs/multi-agent-execution-plan.md)
- [実装進捗一覧](docs/implementation-status.html)、[AI作業ルール](AGENTS.md)、[環境構築手順](docs/environment-setup.md)

## ローカル起動

Node.js 20.9以上とnpmを用意します。依存関係は`package-lock.json`で固定します。T01の画面表示には外部サービス設定は不要です。型検査時の`next-env.d.ts`はNext.jsが生成するため、Gitには含めません。

```powershell
npm ci
npm run dev
```

ブラウザで`http://localhost:3000`を開きます。型検査と本番ビルドは次のコマンドです。

```powershell
npm run typecheck
npm run build
```

後続チケットで外部サービスを使う場合は`.env.example`を`.env.local`へコピーし、利用者が安全な場所で値を設定します。`.env.local`をGitへ追加しません。各環境の区分と秘密の配置は[環境構築手順](docs/environment-setup.md)を参照してください。

## Gitの初期状態

既存の設計資料を残して、このディレクトリを`main`ブランチのローカルGitリポジトリとして管理します。状態と追跡対象は次で確認できます。

```powershell
git branch --show-current
git status --short
git ls-files
git remote -v
```

GitHub作業先は[qtaro-dev/ECsite](https://github.com/qtaro-dev/ECsite)です。既存リポジトリの内容と公開範囲、書き込み権限を確認してから接続します。ユーザーの認証・設定が必要な場合は作業を止め、具体的な操作を案内します。既存履歴を上書きするpushは行いません。

## ディレクトリ

`src/app/(shop)`が公開画面、`src/app/admin`が管理画面、`src/app/api`がサーバー入口です。`src/features`は機能別UI、`src/server`はサーバー専用処理、`src/lib`は共有型・純粋関数を置きます。SQLは`supabase/migrations`、テストは`tests`、API・画面ワイヤーは`docs/api`と`docs/wireframes`に追加します。空ディレクトリの`.gitkeep`は後続チケットで実ファイルを置いた時点で削除できます。
