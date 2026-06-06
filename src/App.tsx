import { ChevronRight, LogOut, MoreHorizontal, Play, Plus, Settings, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import { ActionLogEntry, GameConfig, GameState, PlayerState, Street, TabKey } from "./engine/types";

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
  cash: "Normal: スタックはハンドごとに増減し、収支も連動して記録します。",
  fixed: "スタック固定: 各ハンド開始時に設定スタックへ戻し、収支だけを累積します。"
};

export default function App() {
  const [config, setConfig] = useState<GameConfig>(() => createDefaultConfig());
  const [game, setGame] = useState<GameState | undefined>(() => loadStoredGame());
  const [tab, setTab] = useState<TabKey>("table");
  const [undoStack, setUndoStack] = useState<GameState[]>([]);

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
    setUndoStack([]);
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
        <div className="header-actions">
          <button className="icon-button" onClick={undo} disabled={undoStack.length === 0} title="1つ戻る">
            <Undo2 size={18} />
          </button>
          <button className="icon-button danger" onClick={endGame} title="ゲーム終了">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="content-panel">
        {tab === "table" && <TableView game={game} mutateGame={mutateGame} />}
        {tab === "history" && <HistoryView game={game} />}
        {tab === "graph" && <GraphView game={game} />}
      </section>

      <nav className="footer-tabs" aria-label="画面切り替え">
        <TabButton active={tab === "table"} onClick={() => setTab("table")} label="テーブル" />
        <TabButton active={tab === "history"} onClick={() => setTab("history")} label="アクション履歴" />
        <TabButton active={tab === "graph"} onClick={() => setTab("graph")} label="収支グラフ" />
      </nav>
    </main>
  );
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
          <label>
            <span>ゲームモード</span>
            <select value={config.mode} onChange={(event) => update({ mode: event.target.value as GameConfig["mode"] })}>
              <option value="cash">Normal</option>
              <option value="fixed">スタック固定</option>
            </select>
          </label>
          <label>
            <span>スタック[bb]</span>
            <input type="number" min="0" step="0.1" value={toBbNumber(config.startingStack)} onChange={(event) => update({ startingStack: parseBb(event.target.value) })} />
          </label>
          <label>
            <span>レーキ[%]</span>
            <input type="number" min="0" step="0.1" value={config.rakePercent} onChange={(event) => update({ rakePercent: Math.max(0, Number(event.target.value) || 0) })} />
          </label>
          <label>
            <span>レーキキャップ[bb]</span>
            <input type="number" min="0" step="0.1" value={toBbNumber(config.rakeCap)} onChange={(event) => update({ rakeCap: parseBb(event.target.value) })} />
          </label>
        </div>
        <p className="mode-description">{modeDescriptions[config.mode]}</p>

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
                  value={name}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      playerNames: current.playerNames.map((item, itemIndex) => (itemIndex === index ? event.target.value : item))
                    }))
                  }
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

function TableView({ game, mutateGame }: { game: GameState; mutateGame: (mutator: (current: GameState) => GameState) => void }) {
  const hand = game.hand;
  const displayPots = hand?.displayPots ?? [];
  const totalPot = displayPots.reduce((sum, pot) => sum + pot.amount - pot.rake, 0);
  return (
    <div className="table-layout">
      <div className="poker-table">
        <div className="felt">
          <div className="pot-display">
            <span>Pot</span>
            <strong>{formatBb(totalPot)}</strong>
          </div>
          <div className="side-pot-stack">
            {displayPots.map((pot) => (
              <span key={pot.id}>{pot.label}: {formatBb(pot.amount - pot.rake)}</span>
            ))}
          </div>
          {game.players.map((player, index) => (
            <Seat key={player.id} player={player} index={index} count={game.players.length} game={game} mutateGame={mutateGame} />
          ))}
        </div>
      </div>
      <div className="right-rail">
        <button className="small-button add-ingame" disabled={game.players.length >= 9} onClick={() => mutateGame((current) => addPlayerToGame(current))}>
          <Plus size={16} /> 途中参加
        </button>
        {hand?.street === "showdown" && <ShowdownPanel game={game} mutateGame={mutateGame} />}
        {hand?.street === "complete" && <ResultPanel game={game} mutateGame={mutateGame} />}
        {hand && !["showdown", "complete"].includes(hand.street) && <ActionPanel game={game} mutateGame={mutateGame} />}
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
  mutateGame
}: {
  player: PlayerState;
  index: number;
  count: number;
  game: GameState;
  mutateGame: (mutator: (current: GameState) => GameState) => void;
}) {
  const [open, setOpen] = useState(false);
  const hand = game.hand;
  const angle = -90 + (360 / count) * index;
  const dense = count >= 7;
  const radiusX = dense ? 38 : 36;
  const radiusY = dense ? 42 : 39;
  const x = 50 + radiusX * Math.cos((angle * Math.PI) / 180);
  const y = 50 + radiusY * Math.sin((angle * Math.PI) / 180);
  const markerX = 50 + (radiusX - 11) * Math.cos((angle * Math.PI) / 180);
  const markerY = 50 + (radiusY - 10) * Math.sin((angle * Math.PI) / 180);
  const isCurrent = hand?.currentActorId === player.id;
  const isFolded = hand?.foldedPlayerIds.includes(player.id);
  const isAllIn = hand?.allInPlayerIds.includes(player.id);
  const position = hand ? positionLabel(game, player) : "-";
  const streetBet = hand?.streetBets[player.id] ?? 0;
  const isButton = hand?.buttonSeat === player.seat;
  return (
    <>
      {isButton && <span className="dealer-marker" style={{ left: `${markerX}%`, top: `${markerY}%` }}>D</span>}
      <article className={`seat ${isCurrent ? "current" : ""} ${isFolded ? "folded" : ""}`} style={{ left: `${x}%`, top: `${y}%` }}>
        <button className="seat-menu-button" onClick={() => setOpen(true)} title="プレイヤー操作">
          <MoreHorizontal size={15} />
        </button>
        <span className={`position ${positionClass(position)}`}>{position}</span>
        <input className="name-input" value={player.name} onChange={(event) => mutateGame((current) => updatePlayerName(current, player.id, event.target.value))} />
        <div className="chip-row">
          <span>{formatBb(player.stack)}</span>
          <strong className={player.profit >= 0 ? "profit-plus" : "profit-minus"}>{formatBb(player.profit, true)}</strong>
        </div>
        <div className="bet-row">
          <span>Bet</span>
          <strong>{formatBb(streetBet)}</strong>
        </div>
        <div className="status-row">
          {isAllIn && <em>All in</em>}
          {player.status === "sittingOut" && <em>休憩</em>}
          {player.pendingStatus && <em>次: {player.pendingStatus === "active" ? "復帰" : "休憩"}</em>}
          {player.pendingRemoval && <em>離脱予定</em>}
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
  const applyStack = () => {
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
        <label>
          <span>スタックを設定[bb]</span>
          <input type="number" min="0" step="0.1" value={stackText} onChange={(event) => setStackText(event.target.value)} />
        </label>
        <label className="wide-check">
          <input type="checkbox" checked={adjustProfit} onChange={(event) => setAdjustProfit(event.target.checked)} />
          この調整を収支にも反映する
        </label>
        <button className="primary-button" onClick={applyStack}>スタックを実行</button>
        <div className="dialog-actions">
          <button disabled={!canReturn} onClick={() => { mutateGame((current) => requestPlayerStatus(current, player.id, "active")); close(); }}>復帰</button>
          <button disabled={!canSitOut} onClick={() => { mutateGame((current) => requestPlayerStatus(current, player.id, "sittingOut")); close(); }}>休憩</button>
          <button className="danger-action" onClick={() => { mutateGame((current) => removePlayerFromGame(current, player.id)); close(); }}>離脱</button>
        </div>
      </div>
    </div>
  );
}

function ActionPanel({ game, mutateGame }: { game: GameState; mutateGame: (mutator: (current: GameState) => GameState) => void }) {
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
        {available.canCheck && <button className="call-action" onClick={() => mutateGame((current) => applyAction(current, { type: "check" }))}>Check</button>}
        {available.canRaise && <button className="bet-action" onClick={() => mutateGame((current) => applyAction(current, { type: "raise", amount: boundedAmount }))}>Raise</button>}
        {available.canCall && <button className="call-action" onClick={() => mutateGame((current) => applyAction(current, { type: "call" }))}>Call({formatBb(available.callAmount)})</button>}
        <button className="fold-action" disabled={!available.canFold} onClick={() => mutateGame((current) => applyAction(current, { type: "fold" }))}>Fold</button>
      </div>
    </div>
  );
}

function ShowdownPanel({ game, mutateGame }: { game: GameState; mutateGame: (mutator: (current: GameState) => GameState) => void }) {
  const pots = game.hand?.settlementPots ?? [];
  const [selected, setSelected] = useState<Record<string, string[]>>(() => Object.fromEntries(pots.map((pot) => [pot.id, []])));
  const canSettle = pots.every((pot) => (selected[pot.id] ?? []).length > 0);

  useEffect(() => {
    setSelected(Object.fromEntries(pots.map((pot) => [pot.id, selected[pot.id] ?? []])));
  }, [pots.length]);

  return (
    <div className="showdown-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">Show Down</span>
          <h2>Winner選択</h2>
        </div>
      </div>
      {pots.length === 0 && <div className="notice">自動で獲得できるPotのみです。</div>}
      {pots.map((pot) => (
        <div className="pot-winners" key={pot.id}>
          <div>
            <strong>{pot.label}</strong>
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
      <button className="primary-button" disabled={!canSettle} onClick={() => mutateGame((current) => settlePots(current, selected))}>
        Potを移動 <ChevronRight size={18} />
      </button>
    </div>
  );
}

function ResultPanel({ game, mutateGame }: { game: GameState; mutateGame: (mutator: (current: GameState) => GameState) => void }) {
  return (
    <div className="result-panel">
      <span className="eyebrow">Result</span>
      <h2>Hand {game.lastSettlement?.handNumber}</h2>
      <div className="result-list">
        {game.lastSettlement?.winners.map((row, index) => {
          const player = game.players.find((candidate) => candidate.id === row.playerId);
          return (
            <div key={`${row.potLabel}-${row.playerId}-${index}`}>
              <span>{row.potLabel}</span>
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
      <button className="primary-button" onClick={() => mutateGame(startNextHand)}>
        次のハンド <ChevronRight size={18} />
      </button>
    </div>
  );
}

function HistoryView({ game }: { game: GameState }) {
  const entries = game.hand?.actionLog ?? [];
  const grouped = groupEntriesByStreet(entries);
  return (
    <div className="history-view">
      <div className="section-head">
        <div>
          <span className="eyebrow">Action Log</span>
          <h2>現在のハンド</h2>
        </div>
      </div>
      <div className="history-list">
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
    </div>
  );
}

function GraphView({ game }: { game: GameState }) {
  const width = 680;
  const height = 330;
  const margin = { left: 58, right: 22, top: 20, bottom: 42 };
  const players = game.players;
  const snapshots = game.graph;
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
      {snapshots.length === 0 ? (
        <div className="notice">1ハンド終了後にグラフを表示します。</div>
      ) : (
        <>
          <svg className="profit-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="収支グラフ">
            <text className="axis-label" x={width / 2} y={height - 8} textAnchor="middle">Hand</text>
            <text className="axis-label" x="16" y={height / 2} textAnchor="middle" transform={`rotate(-90 16 ${height / 2})`}>Profit(bb)</text>
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

function groupEntriesByStreet(entries: ActionLogEntry[]): [Street, ActionLogEntry[]][] {
  const order: Street[] = ["preflop", "flop", "turn", "river", "showdown", "complete"];
  const map = new Map<Street, ActionLogEntry[]>();
  for (const entry of entries) {
    map.set(entry.street, [...(map.get(entry.street) ?? []), entry]);
  }
  return order.filter((street) => map.has(street)).map((street) => [street, map.get(street)!]);
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
