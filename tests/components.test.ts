import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../src/components/Button";
import { FormField } from "../src/components/FormField";
import { Skeleton } from "../src/components/Skeleton";
import { StatusMessage } from "../src/components/StatusMessage";

describe("shared design-system components", () => {
  it("renders buttons with the requested variant and native disabled behavior", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { variant: "secondary", type: "submit", disabled: true }, "検索"),
    );

    expect(markup).toContain('type="submit"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("検索");
  });

  it("connects field labels, hints, and errors to the actual input", () => {
    const markup = renderToStaticMarkup(
      createElement(
        FormField,
        {
          id: "email",
          label: "メールアドレス",
          hint: "登録したメールを入力してください。",
          error: "形式を確認してください。",
          children: createElement("input", { type: "email", autoComplete: "email" }),
        },
      ),
    );

    expect(markup).toContain('for="email"');
    expect(markup).toContain('id="email"');
    expect(markup).toContain('aria-describedby="email-hint email-error"');
    expect(markup).toContain('aria-invalid="true"');
  });

  it("uses an alert role and a text label for errors", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusMessage, { kind: "error", title: "在庫を確認できません", children: "時間をおいて再試行してください。" }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("在庫を確認できません");
    expect(markup).toContain("時間をおいて再試行してください。");
  });

  it("exposes skeleton loading as one status with the requested number of shapes", () => {
    const markup = renderToStaticMarkup(createElement(Skeleton, { lines: 2, label: "商品を読み込み中" }));

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="商品を読み込み中"');
    expect(markup.match(/aria-hidden="true"/g)).toHaveLength(2);
  });
});
