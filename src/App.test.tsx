import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the revised setup screen without button selection", () => {
    localStorage.clear();
    render(<App />);

    expect(screen.getByText("Poker Chip Calculator")).toBeInTheDocument();
    expect(screen.getByText("ゲーム開始")).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("スタック固定")).toBeInTheDocument();
    expect(screen.getByText(/Normal: スタックはハンドごとに増減/)).toBeInTheDocument();
    expect(screen.queryByText("最初のBTN")).not.toBeInTheDocument();
    expect(screen.queryByText("BTNプレイヤー")).not.toBeInTheDocument();
  });

  it("shows player popup controls and revised footer labels", () => {
    localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByText("ゲーム開始"));
    expect(screen.getByText("テーブル")).toBeInTheDocument();
    expect(screen.getByText("アクション履歴")).toBeInTheDocument();
    expect(screen.getByText("収支グラフ")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("プレイヤー操作")[0]);
    expect(screen.getByText("スタックを設定[bb]")).toBeInTheDocument();
    expect(screen.getByText("この調整を収支にも反映する")).toBeInTheDocument();
    expect(screen.getByText("スタックを実行")).toBeInTheDocument();
  });
});
