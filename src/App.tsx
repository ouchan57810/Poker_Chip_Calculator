import { ChevronRight, MoreHorizontal, Play, Plus, Settings, Trash2, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import {
  addPlayerToGame,
  adjustStack,
  applyAction,
  createDefaultConfig,
  createGame,
  deriveAvailableActions,
  removePlayerFromGame,
  requestPlayerStatus,
  settlePots,
  startNextHand,
  updatePlayerName
} from "./engine/poker";
import { BB_UNIT, formatBb, parseBb, toBbNumber } from "./engine/money";
import { clearStoredGame, loadStoredGame, saveStoredGame } from "./engine/storage";
import { ActionLogEntry, GameConfig, GameState, PlayerState, ProfitSnapshot, Street, TabKey } from "./engine/types";

const streetLabels: Record<Street, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Show Down",
  complete: "Result"
};

const betShortcuts = [
  ["33%", 0.33],
  ["50%", 0.5],
  ["75%", 0.75],
  ["100%", 1],
  ["125%", 1.25],
  ["All in", "allIn"]
] as const;

const raiseShortcuts = [
  ["2x", 2],
  ["2.5x", 2.5],
  ["3x", 3],
  ["4x", 4],
  ["5x", 5],
  ["All in", "allIn"]
] as const;

const modeDescriptions: Record<GameConfig["mode"], string> = {
  cash: "Normal: スタックはハンドごとに増減します。",
  fixed: "スタック固定: 各ハンド開始時に設定スタックへ戻し、収支だけを累積します。"
};

const isValidPlayerName = (name: string) => name.trim().length > 0;
const playerNameWarning = "プレイヤー名は1文字以上で入力してください。";

type TableLayoutMode = "compact" | "landscape" | "standard" | "wide";

export default function App() {
  const [config, setConfig] = useState<GameConfig>(() => createDefaultConfig());
  const [game, setGame] = useState<GameState | undefined>(() => loadStoredGame());
  const [tab, setTab] = useState<TabKey>("table");
  const [undoStack, setUndoStack] = useState<GameState[]>([]);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const tableLayoutMode = useResponsiveTableLayoutMode();

  useEffect(() => {
    if (!game) return;
    saveStoredGame(game);
  }, [game]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setGame((current) => {
        if (!current) return current;
        const next = { ...current, lastHeartbeatAt: Date.now() };
        saveStoredGame(next);
        return next;
      });
    }, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const beginGame = () => {
    const next = createGame(config);
    setUndoStack([]);
    setTab("table");
    setGame(next);
  };

  const endGame = () => {
    clearStoredGame();
    setConfig(createDefaultConfig());
    setUndoStack([]);
    setTab("table");
    setConfirmEndOpen(false);
    setGame(undefined);
  };

  if (!game) {
    return <SetupScreen config={config} setConfig={setConfig} beginGame={beginGame} />;
  }

  const mutateGame = (mutator: (current: GameState) => GameState) => {
    setGame((current) => {
      if (!current) return current;
      setUndoStack((stack) => [current, ...stack].slice(0, 20));
      return mutator(current);
    });
  };

  const advanceHand = () => {
    setGame((current) => {
      if (!current) return current;
      setUndoStack([]);
      return startNextHand(current);
    });
  };

  const undo = () => {
    setUndoStack((stack) => {
      const [previous, ...rest] = stack;
      if (previous) setGame(previous);
      return rest;
    });
  };

  return (
    <main className="app-shell">
      <header className="game-header">
        <div>
          <span className="eyebrow">Hand {game.handNumber || 1}</span>
          <h1>{game.hand ? streetLabels[game.hand.street] : "Poker Chip Calculator"}</h1>
        </div>
        <div className="header-actions header-stack">
          <button className="text-button" disabled={game.players.length >= 9} onClick={() => mutateGame((current) => addPlayerToGame(current))}>
            人数追加
          </button>
          <button className="text-button danger" onClick={() => setConfirmEndOpen(true)}>
            ゲーム終了
          </button>
        </div>
      </header>

      <section className="content-panel">
        {tab === "table" && <TableView game={game} mutateGame={mutateGame} advanceHand={advanceHand} undo={undo} canUndo={undoStack.length > 0} layoutMode={tableLayoutMode} />}
        {tab === "history" && <HistoryView game={game} />}
        {tab === "graph" && <GraphView game={game} />}
      </section>

      <nav className="footer-tabs" aria-label="画面切り替え">
        <TabButton active={tab === "table"} onClick={() => setTab("table")} label="テーブル" />
        <TabButton active={tab === "history"} onClick={() => setTab("history")} label="アクション履歴" />
        <TabButton active={tab === "graph"} onClick={() => setTab("graph")} label="収支グラフ" />
      </nav>
      {confirmEndOpen && <EndGameDialog onCancel={() => setConfirmEndOpen(false)} onConfirm={endGame} />}
    </main>
  );
}

function useResponsiveTableLayoutMode(): TableLayoutMode {
  const [viewport, setViewport] = useState(() => getViewportSize());

  useEffect(() => {
    const updateViewport = () => {
      const next = getViewportSize();
      document.documentElement.style.setProperty("--app-width", `${next.width}px`);
      document.documentElement.style.setProperty("--app-height", `${next.height}px`);
      setViewport((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    const visualViewport = window.visualViewport;

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    visualViewport?.addEventListener("resize", updateViewport);
    visualViewport?.addEventListener("scroll", updateViewport);
    const interval = window.setInterval(updateViewport, 500);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      visualViewport?.removeEventListener("resize", updateViewport);
      visualViewport?.removeEventListener("scroll", updateViewport);
      window.clearInterval(interval);
    };
  }, []);

  if (viewport.width <= 480 && viewport.height > viewport.width) return "compact";
  if (viewport.height <= 430) return "landscape";
  if (viewport.width >= 1180) return "wide";
  return "standard";
}

function getViewportSize() {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  const visualViewport = window.visualViewport;
  return {
    width: Math.round(visualViewport?.width ?? window.innerWidth),
    height: Math.round(visualViewport?.height ?? window.innerHeight)
  };
}

function SetupScreen({
  config,
  setConfig,
  beginGame
}: {
  config: GameConfig;
  setConfig: (updater: GameConfig | ((current: GameConfig) => GameConfig)) => void;
  beginGame: () => void;
}) {
  const update = (patch: Partial<GameConfig>) => setConfig((current) => ({ ...current, ...patch }));
  const playerCount = config.playerNames.length;
  const [stackText, setStackText] = useState(String(toBbNumber(config.startingStack)));
  const [rakeText, setRakeText] = useState(String(config.rakePercent));
  const [rakeCapText, setRakeCapText] = useState(String(toBbNumber(config.rakeCap)));
  const [playerNameDrafts, setPlayerNameDrafts] = useState(() => config.playerNames);
  const [playerNameBaselines, setPlayerNameBaselines] = useState(() => config.playerNames);
  const [nameWarningIndex, setNameWarningIndex] = useState<number | undefined>();

  useEffect(() => {
    setPlayerNameDrafts(config.playerNames);
    setPlayerNameBaselines(config.playerNames);
    setNameWarningIndex((current) => (current !== undefined && current >= config.playerNames.length ? undefined : current));
  }, [config.playerNames.length]);

  const updateStackText = (value: string) => {
    setStackText(value);
    if (value === "") return;
    update({ startingStack: parseBb(value) });
  };

  const updateRakeText = (value: string) => {
    setRakeText(value);
    if (value === "") return;
    const next = Number(value);
    if (Number.isFinite(next)) update({ rakePercent: Math.max(0, next) });
  };

  const updateRakeCapText = (value: string) => {
    setRakeCapText(value);
    if (value === "") return;
    update({ rakeCap: parseBb(value) });
  };

  const restoreEmptyNumberFields = () => {
    if (stackText === "") setStackText(String(toBbNumber(config.startingStack)));
    if (rakeText === "") setRakeText(String(config.rakePercent));
    if (rakeCapText === "") setRakeCapText(String(toBbNumber(config.rakeCap)));
  };

  const beginPlayerNameEdit = (index: number) => {
    setPlayerNameBaselines((current) => current.map((item, itemIndex) => (itemIndex === index ? config.playerNames[index] : item)));
    if (nameWarningIndex === index) setNameWarningIndex(undefined);
  };

  const updatePlayerNameDraft = (index: number, value: string) => {
    setPlayerNameDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
    if (nameWarningIndex === index) setNameWarningIndex(undefined);
  };

  const finishPlayerNameEdit = (index: number) => {
    const draft = playerNameDrafts[index] ?? config.playerNames[index];
    const baseline = playerNameBaselines[index] ?? config.playerNames[index];
    const nextName = draft.trim();
    if (!isValidPlayerName(nextName)) {
      setPlayerNameDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? baseline : item)));
      setNameWarningIndex(index);
      return;
    }

    setNameWarningIndex(undefined);
    setPlayerNameDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? nextName : item)));
    setConfig((current) => ({
      ...current,
      playerNames: current.playerNames.map((item, itemIndex) => (itemIndex === index ? nextName : item))
    }));
  };

  return (
    <main className="setup-shell">
      <section className="setup-board">
        <div className="setup-title">
          <Settings size={22} />
          <div>
            <span className="eyebrow">Cash Game</span>
            <h1>Poker Chip Calculator</h1>
          </div>
        </div>

        <div className="setup-grid">
          <label className="mode-field">
            <span>ゲームモード</span>
            <select value={config.mode} onChange={(event) => update({ mode: event.target.value as GameConfig["mode"] })}>
              <option value="cash">Normal</option>
              <option value="fixed">スタック固定</option>
            </select>
            <p className="mode-description">{modeDescriptions[config.mode]}</p>
          </label>
          <label className="stack-field">
            <span>スタック[bb]</span>
            <input type="number" min="0" step="0.1" value={stackText} onBlur={restoreEmptyNumberFields} onChange={(event) => updateStackText(event.target.value)} />
          </label>
          <label className="rake-field">
            <span>レーキ[%]</span>
            <input type="number" min="0" step="0.1" value={rakeText} onBlur={restoreEmptyNumberFields} onChange={(event) => updateRakeText(event.target.value)} />
          </label>
          <label className="rake-cap-field">
            <span>レーキキャップ[bb]</span>
            <input type="number" min="0" step="0.1" value={rakeCapText} onBlur={restoreEmptyNumberFields} onChange={(event) => updateRakeCapText(event.target.value)} />
          </label>
        </div>

        <div className="players-editor">
          <div className="section-head">
            <div>
              <span className="eyebrow">{playerCount} players</span>
              <h2>プレイヤー</h2>
            </div>
            <button
              className="small-button"
              onClick={() => setConfig((current) => ({ ...current, playerNames: [...current.playerNames, `Player ${current.playerNames.length + 1}`] }))}
              disabled={playerCount >= 9}
            >
              <Plus size={16} /> 追加
            </button>
          </div>
          <div className="player-name-list">
            {config.playerNames.map((name, index) => (
              <div className="player-name-row" key={index}>
                <span>{index + 1}</span>
                <input
                  required
                  minLength={1}
                  aria-invalid={nameWarningIndex === index}
                  aria-describedby={nameWarningIndex === index ? `setup-player-name-warning-${index}` : undefined}
                  value={playerNameDrafts[index] ?? name}
                  onFocus={() => beginPlayerNameEdit(index)}
                  onChange={(event) => updatePlayerNameDraft(index, event.target.value)}
                  onBlur={() => finishPlayerNameEdit(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
                <button
                  className="icon-button"
                  disabled={playerCount <= 2}
                  onClick={() =>
                    setConfig((current) => ({
                      ...current,
                      playerNames: current.playerNames.filter((_, itemIndex) => itemIndex !== index)
                    }))
                  }
                  title="削除"
                >
                  <Trash2 size={16} />
                </button>
                {nameWarningIndex === index && (
                  <p className="field-warning" id={`setup-player-name-warning-${index}`} role="alert">
                    {playerNameWarning}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <button className="primary-button" onClick={beginGame}>
          <Play size={18} /> ゲーム開始
        </button>
      </section>
    </main>
  );
}

function EndGameDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="confirm-dialog">
        <div>
          <span className="eyebrow">End Game</span>
          <h2>本当に終了しますか？</h2>
        </div>
        <p>現在のゲーム状態をリセットして設定画面に戻ります。</p>
        <div className="dialog-actions">
          <button onClick={onCancel}>キャンセル</button>
          <button className="danger-action" onClick={onConfirm}>終了する</button>
        </div>
      </div>
    </div>
  );
}

function TableView({
  game,
  mutateGame,
  advanceHand,
  undo,
  canUndo,
  layoutMode
}: {
  game: GameState;
  mutateGame: (mutator: (current: GameState) => GameState) => void;
  advanceHand: () => void;
  undo: () => void;
  canUndo: boolean;
  layoutMode: TableLayoutMode;
}) {
  const hand = game.hand;
  const displayPots = hand?.displayPots ?? [];
  const mainPot = displayPots[0];
  const sidePots = displayPots.slice(1);
  const topSidePots = sidePots.length >= 5 ? sidePots.slice(0, Math.max(0, sidePots.length - 4)) : [];
  const bottomSidePots = sidePots.length >= 5 ? sidePots.slice(Math.max(0, sidePots.length - 4)) : sidePots;
  return (
    <div className="table-layout">
      <div className="poker-table">
        <div className="felt">
          <div className="pot-display">
            <span>Pot</span>
            <strong>{formatBb(mainPot ? mainPot.amount - mainPot.rake : 0)}</strong>
          </div>
          {topSidePots.length > 0 && (
            <div className="side-pot-stack side-pot-top">
              {topSidePots.map((pot) => (
                <span key={pot.id}>{pot.label}: {formatBb(pot.amount - pot.rake)}</span>
              ))}
            </div>
          )}
          {bottomSidePots.length > 0 && (
            <div className="side-pot-stack side-pot-bottom">
              {bottomSidePots.map((pot) => (
              <span key={pot.id}>{pot.label}: {formatBb(pot.amount - pot.rake)}</span>
              ))}
            </div>
          )}
          {game.players.map((player, index) => (
            <Seat key={player.id} player={player} index={index} count={game.players.length} game={game} mutateGame={mutateGame} layoutMode={layoutMode} />
          ))}
        </div>
      </div>
      <div className="right-rail">
        {hand?.street === "showdown" && <ShowdownModal game={game} mutateGame={mutateGame} />}
        {hand?.street === "complete" && <ResultModal game={game} advanceHand={advanceHand} />}
        {hand && !["showdown", "complete"].includes(hand.street) && <ActionPanel game={game} mutateGame={mutateGame} undo={undo} canUndo={canUndo} />}
        {!hand && <div className="notice">参加中のプレイヤーが2人以上になると開始できます。</div>}
      </div>
    </div>
  );
}

function Seat({
  player,
  index,
  count,
  game,
  mutateGame,
  layoutMode
}: {
  player: PlayerState;
  index: number;
  count: number;
  game: GameState;
  mutateGame: (mutator: (current: GameState) => GameState) => void;
  layoutMode: TableLayoutMode;
}) {
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(player.name);
  const [nameBaseline, setNameBaseline] = useState(player.name);
  const [nameWarning, setNameWarning] = useState(false);
  const hand = game.hand;
  const layout = seatLayout(index, count, layoutMode);
  const isCurrent = hand?.currentActorId === player.id;
  const isFolded = hand?.foldedPlayerIds.includes(player.id);
  const position = hand ? positionLabel(game, player) : "-";
  const streetBet = hand?.streetBets[player.id] ?? 0;
  const isButton = hand?.buttonSeat === player.seat;

  useEffect(() => {
    setNameDraft(player.name);
    setNameBaseline(player.name);
    setNameWarning(false);
  }, [player.name]);

  const finishSeatNameEdit = () => {
    const nextName = nameDraft.trim();
    if (!isValidPlayerName(nextName)) {
      setNameDraft(nameBaseline);
      setNameWarning(true);
      return;
    }
    setNameWarning(false);
    setNameDraft(nextName);
    mutateGame((current) => updatePlayerName(current, player.id, nextName));
  };

  return (
    <>
      {streetBet > 0 && <span className="seat-bet-chip" style={{ left: `${layout.betX}%`, top: `${layout.betY}%` }}>{formatBb(streetBet)}</span>}
      <article className={`seat ${isCurrent ? "current" : ""} ${isFolded ? "folded" : ""}`} style={{ left: `${layout.x}%`, top: `${layout.y}%` }}>
        {isButton && <span className="dealer-marker">D</span>}
        <button className="seat-menu-button" onClick={() => setOpen(true)} title="プレイヤー操作">
          <MoreHorizontal size={15} />
        </button>
        <span className={`position ${positionClass(position)}`}>{position}</span>
        <input
          className="name-input"
          required
          minLength={1}
          aria-invalid={nameWarning}
          aria-describedby={nameWarning ? `seat-name-warning-${player.id}` : undefined}
          value={nameDraft}
          onFocus={() => {
            setNameBaseline(player.name);
            setNameWarning(false);
          }}
          onChange={(event) => {
            setNameDraft(event.target.value);
            if (nameWarning) setNameWarning(false);
          }}
          onBlur={finishSeatNameEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {nameWarning && (
          <p className="seat-name-warning" id={`seat-name-warning-${player.id}`} role="alert">
            {playerNameWarning}
          </p>
        )}
        <div className="chip-row">
          <span>{formatBb(player.stack)}</span>
          <strong className={player.profit >= 0 ? "profit-plus" : "profit-minus"}>{formatBb(player.profit, true)}</strong>
        </div>
      </article>
      {open && <PlayerDialog player={player} game={game} mutateGame={mutateGame} close={() => setOpen(false)} />}
    </>
  );
}

function PlayerDialog({
  player,
  game,
  mutateGame,
  close
}: {
  player: PlayerState;
  game: GameState;
  mutateGame: (mutator: (current: GameState) => GameState) => void;
  close: () => void;
}) {
  const [stackText, setStackText] = useState(String(toBbNumber(game.config.startingStack)));
  const [adjustProfit, setAdjustProfit] = useState(false);
  const canSitOut = player.status === "active" && !player.pendingRemoval;
  const canReturn = player.status === "sittingOut" && !player.pendingRemoval;
  const stackEditingDisabled = game.config.mode === "fixed";
  const applyStack = () => {
    if (stackEditingDisabled) return;
    mutateGame((current) => adjustStack(current, player.id, parseBb(stackText), adjustProfit));
    close();
  };
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="player-dialog">
        <div className="dialog-head">
          <strong>{player.name}</strong>
          <button className="icon-button" onClick={close} title="閉じる">
            <X size={16} />
          </button>
        </div>
        <label className={stackEditingDisabled ? "disabled-field" : ""}>
          <span>スタックを設定[bb]</span>
          <input type="number" min="0" step="0.1" value={stackText} disabled={stackEditingDisabled} onChange={(event) => setStackText(event.target.value)} />
        </label>
        <label className={`wide-check ${stackEditingDisabled ? "disabled-field" : ""}`}>
          <input type="checkbox" checked={adjustProfit} disabled={stackEditingDisabled} onChange={(event) => setAdjustProfit(event.target.checked)} />
          この調整を収支にも反映する
        </label>
        <button className="primary-button" disabled={stackEditingDisabled} onClick={applyStack}>スタックに反映</button>
        <div className="dialog-actions">
          <button disabled={!canReturn} onClick={() => { mutateGame((current) => requestPlayerStatus(current, player.id, "active")); close(); }}>復帰</button>
          <button disabled={!canSitOut} onClick={() => { mutateGame((current) => requestPlayerStatus(current, player.id, "sittingOut")); close(); }}>休憩</button>
          <button className="danger-action" onClick={() => { mutateGame((current) => removePlayerFromGame(current, player.id)); close(); }}>離席</button>
        </div>
      </div>
    </div>
  );
}

function ActionPanel({
  game,
  mutateGame,
  undo,
  canUndo
}: {
  game: GameState;
  mutateGame: (mutator: (current: GameState) => GameState) => void;
  undo: () => void;
  canUndo: boolean;
}) {
  const available = deriveAvailableActions(game);
  const player = game.players.find((candidate) => candidate.id === available.playerId);
  const hand = game.hand!;
  const [amount, setAmount] = useState(available.canBet ? available.minBet : available.minRaiseTo);
  const [selectedShortcut, setSelectedShortcut] = useState("min");

  useEffect(() => {
    setAmount(available.canBet ? available.minBet : available.canRaise ? available.minRaiseTo : available.maxTotal);
    setSelectedShortcut("min");
  }, [available.playerId, available.minBet, available.minRaiseTo, available.maxTotal, available.canBet, available.canRaise]);

  if (!player) return <div className="notice">次のアクションを計算中です。</div>;
  const pot = hand.displayPots.reduce((sum, item) => sum + item.amount - item.rake, 0);
  const min = available.canBet ? available.minBet : available.minRaiseTo;
  const max = Math.max(min, available.maxTotal);
  const boundedAmount = clampNumber(amount, min, max);
  const shortcuts = available.canBet ? betShortcuts : raiseShortcuts;
  const canSize = available.canBet || available.canRaise;

  const chooseShortcut = (label: string, value: number | "allIn") => {
    const nextAmount = value === "allIn" ? max : available.canBet ? Math.round(pot * value) : Math.round(hand.currentBet * value);
    setAmount(clampNumber(nextAmount, min, max));
    setSelectedShortcut(label);
  };

  return (
    <div className="action-panel">
      {canSize && (
        <>
          <label className="range-row">
            <span>{available.canBet ? "Bet" : "Raise"} {formatBb(boundedAmount)}</span>
            <button type="button" className="undo-text-button" onClick={undo} disabled={!canUndo}>一つ戻す</button>
            <input type="range" min={min} max={max} step={BB_UNIT / 10} value={boundedAmount} onChange={(event) => { setAmount(Number(event.target.value)); setSelectedShortcut("custom"); }} />
          </label>
          <div className="shortcut-grid">
            {shortcuts.map(([label, value]) => (
              <button className={selectedShortcut === label ? "selected" : ""} key={label} onClick={() => chooseShortcut(label, value)}>
                {label}
              </button>
            ))}
          </div>
          {amount < min && <p className="warning">下限は {formatBb(min)} です。</p>}
        </>
      )}

      <div className="action-buttons">
        {available.canBet && <button className="bet-action" onClick={() => mutateGame((current) => applyAction(current, { type: "bet", amount: boundedAmount }))}>Bet</button>}
        {available.canRaise && <button className="bet-action" onClick={() => mutateGame((current) => applyAction(current, { type: "raise", amount: boundedAmount }))}>Raise</button>}
        {available.canCheck && <button className="call-action" onClick={() => mutateGame((current) => applyAction(current, { type: "check" }))}>Check</button>}
        {available.canCall && <button className="call-action" onClick={() => mutateGame((current) => applyAction(current, { type: "call" }))}>Call({formatBb(available.callAmount)})</button>}
        <button className="fold-action" disabled={!available.canFold} onClick={() => mutateGame((current) => applyAction(current, { type: "fold" }))}>Fold</button>
      </div>
    </div>
  );
}

function ShowdownModal({ game, mutateGame }: { game: GameState; mutateGame: (mutator: (current: GameState) => GameState) => void }) {
  const pots = game.hand?.settlementPots ?? [];
  const [selected, setSelected] = useState<Record<string, string[]>>(() => Object.fromEntries(pots.map((pot) => [pot.id, []])));
  const canSettle = pots.every((pot) => (selected[pot.id] ?? []).length > 0);
  const hasSidePots = (game.hand?.displayPots.length ?? 0) > 1;

  useEffect(() => {
    setSelected(Object.fromEntries(pots.map((pot) => [pot.id, selected[pot.id] ?? []])));
  }, [pots.length]);

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="settlement-dialog">
        <div className="section-head">
          <div>
            <span className="eyebrow">Show Down</span>
            <h2>Winner選択</h2>
          </div>
        </div>
        <div className="settlement-scroll">
          {pots.length === 0 && <div className="notice">自動で獲得できるPotのみです。</div>}
          {pots.map((pot) => (
            <div className="pot-winners" key={pot.id}>
              <div>
                <strong>{hasSidePots ? pot.label : "Pot"}</strong>
                <span>{formatBb(pot.amount - pot.rake)} {pot.rake > 0 && `(Rake ${formatBb(pot.rake)})`}</span>
              </div>
              {pot.eligiblePlayerIds.map((id) => {
                const player = game.players.find((candidate) => candidate.id === id)!;
                const checked = selected[pot.id]?.includes(id) ?? false;
                return (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        setSelected((current) => ({
                          ...current,
                          [pot.id]: event.target.checked ? [...(current[pot.id] ?? []), id] : (current[pot.id] ?? []).filter((item) => item !== id)
                        }))
                      }
                    />
                    {player.name}
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <button className="primary-button" disabled={!canSettle} onClick={() => mutateGame((current) => settlePots(current, selected))}>
          Potを移動 <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function ResultModal({ game, advanceHand }: { game: GameState; advanceHand: () => void }) {
  const hasSidePots = (game.hand?.displayPots.length ?? 0) > 1;
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="settlement-dialog">
        <span className="eyebrow">Result</span>
        <h2>Hand {game.lastSettlement?.handNumber}</h2>
        <div className="settlement-scroll result-list">
          {game.lastSettlement?.winners.map((row, index) => {
            const player = game.players.find((candidate) => candidate.id === row.playerId);
            const potLabel = hasSidePots ? row.potLabel : "Pot";
            return (
              <div key={`${row.potLabel}-${row.playerId}-${index}`}>
                <span>{potLabel}</span>
                <strong>{player?.name ?? row.playerId}</strong>
                <em>{formatBb(row.amount)}</em>
              </div>
            );
          })}
          {game.lastSettlement && game.lastSettlement.rake > 0 && (
            <div>
              <span>Rake</span>
              <strong>Table out</strong>
              <em>{formatBb(game.lastSettlement.rake)}</em>
            </div>
          )}
        </div>
        <button className="primary-button" onClick={advanceHand}>
          次のハンド <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function HistoryView({ game }: { game: GameState }) {
  return (
    <div className="history-view">
      <div className="history-scroll">
        <HandHistorySection title="現在のアクション履歴" eyebrow={`Hand ${(game.hand?.handNumber ?? game.handNumber) || 1}`} entries={game.hand?.actionLog ?? []} />
        <HandHistorySection title="1つ前のアクション履歴" eyebrow={game.previousHandLog ? `Hand ${game.previousHandLog.handNumber}` : "Previous Hand"} entries={game.previousHandLog?.entries ?? []} />
      </div>
    </div>
  );
}

function HandHistorySection({ title, eyebrow, entries }: { title: string; eyebrow: string; entries: ActionLogEntry[] }) {
  const grouped = groupEntriesByStreet(entries);
  return (
    <section className="history-section">
      <div className="section-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="history-list">
        {grouped.length === 0 && <div className="notice compact-notice">履歴はまだありません。</div>}
        {grouped.map(([street, rows]) => (
          <div className="history-street" key={street}>
            <div className="street-separator">{streetLabels[street]}</div>
            {rows.map((entry) => (
              <div className="history-row" key={entry.id}>
                <span>{entry.position}</span>
                <strong>{entry.playerName}</strong>
                <em>{entry.label}</em>
                <b>{entry.amount ? formatBb(entry.amount) : "-"}</b>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function GraphView({ game }: { game: GameState }) {
  const width = 680;
  const height = 330;
  const margin = { left: 82, right: 24, top: 24, bottom: 54 };
  const players = game.players;
  const snapshots = withOriginSnapshot(game);
  const values = snapshots.flatMap((snap) => Object.values(snap.profits));
  const maxAbs = Math.max(BB_UNIT, ...values.map((value) => Math.abs(value)));
  const niceAbs = niceCeil(maxAbs);
  const minValue = -niceAbs;
  const maxValue = niceAbs;
  const ticks = buildTicks(niceAbs);
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xFor = (index: number) => (snapshots.length <= 1 ? margin.left : margin.left + (index / (snapshots.length - 1)) * plotW);
  const yFor = (value: number) => margin.top + ((maxValue - value) / Math.max(1, maxValue - minValue)) * plotH;
  const colors = ["#f6c85f", "#7bdff2", "#f28482", "#84dcc6", "#cdb4db", "#bde0fe", "#ffafcc", "#d0f4de", "#ffd6a5"];

  return (
    <div className="graph-view">
      <div className="section-head">
        <div>
          <span className="eyebrow">Profit Graph</span>
          <h2>収支グラフ</h2>
        </div>
      </div>
      {game.graph.length === 0 ? (
        <div className="notice">1ハンド終了後にグラフを表示します。</div>
      ) : (
        <>
          <svg className="profit-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="収支グラフ">
            <text className="axis-label" x={width / 2} y={height - 8} textAnchor="middle">Hand</text>
            <text className="axis-label" x="22" y={height / 2} textAnchor="middle" transform={`rotate(-90 22 ${height / 2})`}>Profit(bb)</text>
            <line className="axis-line" x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} />
            <line className="axis-line" x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} />
            {ticks.map((tick) => (
              <g key={tick}>
                <line className={tick === 0 ? "zero-line" : "grid-line"} x1={margin.left} y1={yFor(tick)} x2={width - margin.right} y2={yFor(tick)} />
                <text className="tick-label" x={margin.left - 8} y={yFor(tick) + 4} textAnchor="end">{formatBb(tick, true)}</text>
              </g>
            ))}
            {snapshots.map((snap, index) => (
              <text className="tick-label" key={snap.handNumber} x={xFor(index)} y={height - margin.bottom + 18} textAnchor="middle">{snap.handNumber}</text>
            ))}
            {players.map((player, playerIndex) => {
              const points = snapshots.map((snap, index) => `${xFor(index)},${yFor(snap.profits[player.id] ?? 0)}`).join(" ");
              return <polyline key={player.id} points={points} stroke={colors[playerIndex % colors.length]} />;
            })}
          </svg>
          <div className="legend">
            {players.map((player, index) => (
              <span key={player.id} style={{ "--dot": colors[index % colors.length] } as CSSProperties}>
                {player.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      <span>{label}</span>
    </button>
  );
}

function positionLabel(game: GameState, player: PlayerState): string {
  const hand = game.hand;
  if (!hand) return "-";
  const active = game.players.filter((candidate) => candidate.status === "active" && !candidate.pendingRemoval).sort((a, b) => a.seat - b.seat);
  if (active.length === 2) return player.seat === hand.buttonSeat ? "SB" : "BB";
  const buttonIndex = active.findIndex((candidate) => candidate.seat === hand.buttonSeat);
  const playerIndex = active.findIndex((candidate) => candidate.id === player.id);
  const offset = (playerIndex - buttonIndex + active.length) % active.length;
  const names: Record<number, string[]> = {
    3: ["BTN", "SB", "BB"],
    4: ["BTN", "SB", "BB", "UTG"],
    5: ["BTN", "SB", "BB", "UTG", "CO"],
    6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
    7: ["BTN", "SB", "BB", "UTG", "LJ", "HJ", "CO"],
    8: ["BTN", "SB", "BB", "UTG", "UTG+1", "LJ", "HJ", "CO"],
    9: ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"]
  };
  return names[active.length]?.[offset] ?? "-";
}

function positionClass(position: string): string {
  if (position.includes("BB")) return "pos-bb";
  if (position.includes("SB")) return "pos-sb";
  if (position.includes("BTN")) return "pos-btn";
  return "";
}

interface SeatLayout {
  x: number;
  y: number;
  betX: number;
  betY: number;
}

const compactSeatPositions: Partial<Record<number, { x: number; y: number }[]>> = {
  7: [
    { x: 50, y: 14 },
    { x: 78, y: 29 },
    { x: 82, y: 56 },
    { x: 62, y: 77 },
    { x: 38, y: 77 },
    { x: 18, y: 56 },
    { x: 22, y: 29 }
  ],
  8: [
    { x: 50, y: 13 },
    { x: 75, y: 24 },
    { x: 86, y: 45 },
    { x: 73, y: 67 },
    { x: 50, y: 79 },
    { x: 27, y: 67 },
    { x: 14, y: 45 },
    { x: 25, y: 24 }
  ],
  9: [
    { x: 50, y: 11 },
    { x: 73, y: 20 },
    { x: 88, y: 43 },
    { x: 82, y: 66 },
    { x: 62, y: 84 },
    { x: 38, y: 84 },
    { x: 18, y: 66 },
    { x: 12, y: 43 },
    { x: 27, y: 20 }
  ]
};

const landscapeSeatPositions: Partial<Record<number, { x: number; y: number }[]>> = {
  9: [
    { x: 50, y: 12 },
    { x: 72, y: 18 },
    { x: 91, y: 36 },
    { x: 82, y: 66 },
    { x: 62, y: 83 },
    { x: 38, y: 83 },
    { x: 18, y: 66 },
    { x: 9, y: 36 },
    { x: 28, y: 18 }
  ]
};

function seatLayout(index: number, count: number, mode: TableLayoutMode): SeatLayout {
  const compactPosition = mode === "compact" ? compactSeatPositions[count]?.[index] : undefined;
  if (compactPosition) return withBetTowardCenter(compactPosition.x, compactPosition.y, 0.52);

  const landscapePosition = mode === "landscape" ? landscapeSeatPositions[count]?.[index] : undefined;
  if (landscapePosition) return withBetTowardCenter(landscapePosition.x, landscapePosition.y, 0.68);

  const angle = -90 + (360 / count) * index;
  const dense = count >= 7;
  const radii = layoutRadii(mode, dense);
  const radialX = Math.cos((angle * Math.PI) / 180);
  const radialY = Math.sin((angle * Math.PI) / 180);
  const x = 50 + radii.seatX * radialX;
  const y = 50 + radii.seatY * radialY;
  return withBetTowardCenter(x, y, radii.betRatio);
}

function layoutRadii(mode: TableLayoutMode, dense: boolean) {
  if (mode === "wide") {
    return { seatX: dense ? 36 : 34, seatY: dense ? 38 : 36, betRatio: 0.46 };
  }
  if (mode === "landscape") {
    return { seatX: dense ? 40 : 37, seatY: dense ? 36 : 34, betRatio: 0.6 };
  }
  return { seatX: dense ? 38 : 36, seatY: dense ? 39 : 37, betRatio: 0.44 };
}

function withBetTowardCenter(x: number, y: number, centerRatio: number): SeatLayout {
  return {
    x,
    y,
    betX: x + (50 - x) * centerRatio,
    betY: y + (50 - y) * centerRatio
  };
}

function groupEntriesByStreet(entries: ActionLogEntry[]): [Street, ActionLogEntry[]][] {
  const order: Street[] = ["preflop", "flop", "turn", "river", "showdown", "complete"];
  const map = new Map<Street, ActionLogEntry[]>();
  for (const entry of entries) {
    map.set(entry.street, [...(map.get(entry.street) ?? []), entry]);
  }
  return order.filter((street) => map.has(street)).map((street) => [street, map.get(street)!]);
}

function withOriginSnapshot(game: GameState): ProfitSnapshot[] {
  return [
    {
      handNumber: 0,
      profits: Object.fromEntries(game.players.map((player) => [player.id, 0]))
    },
    ...game.graph
  ];
}

function niceCeil(value: number): number {
  const bbValue = value / BB_UNIT;
  const steps = [1, 2, 5, 10, 25, 50, 100, 200, 500];
  const step = steps.find((candidate) => candidate >= bbValue) ?? Math.ceil(bbValue / 100) * 100;
  return step * BB_UNIT;
}

function buildTicks(maxAbs: number): number[] {
  const half = Math.round(maxAbs / 2);
  return [-maxAbs, -half, 0, half, maxAbs];
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
