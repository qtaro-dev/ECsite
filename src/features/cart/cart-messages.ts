export const cartAddMessages = {
  label: 'カートに追加',
  pending: '追加中…',
  success: '商品をカートに追加しました。現在の価格と販売可能数はカートで確認できます。',
} as const;

export function cartFailureMessage(status: number, code?: string): string {
  if (status === 409 || code === 'CONFLICT') return '販売可能数が更新されました。該当商品の数量を確認してください。';
  if (status === 404 || code === 'NOT_FOUND') return '商品が販売終了、または現在カートに追加できません。商品一覧から別の商品をお選びください。';
  if (status === 400 || code === 'BAD_REQUEST') return 'カートの操作内容を確認できませんでした。ページを再読み込みしてください。';
  return 'カートに接続できませんでした。通信状態を確認して再試行してください。';
}
