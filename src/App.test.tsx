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
    expect(screen.getByText("Normal: スタックはハンドごとに増減します。")).toBeInTheDocument();
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
    expect(screen.getByText("ゲーム終了")).toBeInTheDocument();
    expect(screen.getByText("人数追加")).toBeInTheDocument();
    expect(screen.queryByText("途中参加")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("プレイヤー操作")[0]);
    expect(screen.getByText("スタックを設定[bb]")).toBeInTheDocument();
    expect(screen.getByText("この調整を収支にも反映する")).toBeInTheDocument();
    expect(screen.getByText("スタックに反映")).toBeInTheDocument();
    expect(screen.getByText("離席")).toBeInTheDocument();
    expect(screen.queryByText("スタックを実行")).not.toBeInTheDocument();
    expect(screen.queryByText("離脱")).not.toBeInTheDocument();
  });

  it("shows the revised undo label and current plus previous history panes", () => {
    localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByText("ゲーム開始"));
    expect(screen.getByText("一つ戻す")).toBeInTheDocument();
    expect(screen.getByText("一つ戻す")).toBeDisabled();
    expect(screen.queryByText("一つ戻る")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("アクション履歴"));
    expect(screen.getByText("現在のアクション履歴")).toBeInTheDocument();
    expect(screen.getByText("1つ前のアクション履歴")).toBeInTheDocument();
  });

  it("keeps raise before check when both actions are available after a limp", () => {
    localStorage.clear();
    const { container } = render(<App />);

    fireEvent.click(screen.getByText("ゲーム開始"));
    fireEvent.click(screen.getByText("Call(0.5bb)"));

    const buttons = Array.from(container.querySelectorAll(".action-buttons button")).map((button) => button.textContent);
    expect(buttons).toEqual(["Raise", "Check", "Fold"]);
  });

  it("disables undo immediately after advancing to the next hand", () => {
    localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByText("ゲーム開始"));
    fireEvent.click(screen.getByText("Fold"));
    fireEvent.click(screen.getByText("次のハンド"));

    expect(screen.getByText("一つ戻す")).toBeDisabled();
  });

  it("keeps the start action reachable after setting up nine players", () => {
    localStorage.clear();
    render(<App />);

    for (let index = 0; index < 7; index += 1) {
      fireEvent.click(screen.getByText("追加"));
    }

    expect(screen.getByText("9 players")).toBeInTheDocument();
    expect(screen.getByText("ゲーム開始")).toBeInTheDocument();
  });

  it("renders the profit graph from hand zero after the first hand completes", () => {
    localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByText("ゲーム開始"));
    fireEvent.click(screen.getByText("Fold"));
    fireEvent.click(screen.getByText("収支グラフ"));

    expect(screen.getByRole("img", { name: "収支グラフ" })).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("confirms before ending a game", () => {
    localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByText("ゲーム開始"));
    fireEvent.click(screen.getByText("ゲーム終了"));

    expect(screen.getByText("本当に終了しますか？")).toBeInTheDocument();
    expect(screen.getByText("キャンセル")).toBeInTheDocument();
    expect(screen.getByText("終了する")).toBeInTheDocument();
  });
});
