import { afterEach, describe, expect, it, vi } from "vitest";
import { bb, formatBb, parseBb, toBbNumber } from "./money";
import {
  addPlayerToGame,
  adjustStack,
  applyAction,
  buildPots,
  createDefaultConfig,
  createGame,
  deriveAvailableActions,
  removePlayerFromGame,
  settlePots,
  startNextHand
} from "./poker";
import { HandState } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

function fixedButtonGame(playerNames = ["Player 1", "Player 2"]) {
  vi.spyOn(Math, "random").mockReturnValue(0);
  return createGame({ ...createDefaultConfig(), playerNames });
}

describe("bb money helpers", () => {
  it("stores two decimals and displays one decimal without redundant .0", () => {
    expect(bb(1.234)).toBe(123);
    expect(toBbNumber(bb(12.349))).toBe(12.35);
    expect(parseBb("1.235")).toBe(124);
    expect(formatBb(bb(12.34))).toBe("12.3bb");
    expect(formatBb(bb(12))).toBe("12bb");
    expect(formatBb(0, true)).toBe("+0bb");
  });
});

describe("Texas Hold'em engine", () => {
  it("uses heads-up blinds and preflop action order", () => {
    const game = fixedButtonGame();

    expect(game.hand?.buttonSeat).toBe(0);
    expect(game.hand?.smallBlindSeat).toBe(0);
    expect(game.hand?.bigBlindSeat).toBe(1);
    expect(game.hand?.currentActorId).toBe("p-1");
  });

  it("uses UTG first preflop with 6 players", () => {
    const game = fixedButtonGame(["A", "B", "C", "D", "E", "F"]);

    expect(game.hand?.smallBlindSeat).toBe(1);
    expect(game.hand?.bigBlindSeat).toBe(2);
    expect(game.hand?.currentActorId).toBe("p-4");
  });

  it("does not create side pots for ordinary blind differences", () => {
    const hand = {
      committed: { a: bb(0.5), b: bb(1) },
      foldedPlayerIds: [],
      allInPlayerIds: []
    } as unknown as HandState;

    const pots = buildPots(hand, 0, 0);

    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(bb(1.5));
    expect(pots[0].eligiblePlayerIds).toEqual(["a", "b"]);
  });

  it("builds main and side pots from uneven all-in commitments", () => {
    const hand = {
      committed: { a: bb(10), b: bb(20), c: bb(30) },
      foldedPlayerIds: [],
      allInPlayerIds: ["a", "b", "c"]
    } as unknown as HandState;

    const pots = buildPots(hand, 0, 0);

    expect(pots.map((pot) => pot.amount)).toEqual([bb(30), bb(20), bb(10)]);
    expect(pots[0].eligiblePlayerIds).toEqual(["a", "b", "c"]);
    expect(pots[1].eligiblePlayerIds).toEqual(["b", "c"]);
    expect(pots[2].eligiblePlayerIds).toEqual(["c"]);
  });

  it("takes actual rake from main pot first and stops when the cap is reached", () => {
    const hand = {
      committed: { a: bb(10), b: bb(20), c: bb(30) },
      foldedPlayerIds: [],
      allInPlayerIds: ["a", "b", "c"]
    } as unknown as HandState;

    const pots = buildPots(hand, 10, bb(2));

    expect(pots.map((pot) => pot.rake)).toEqual([bb(2), 0, 0]);
    expect(pots.reduce((sum, pot) => sum + pot.rake, 0)).toBe(bb(2));
  });

  it("carries remaining rake cap from the main pot into side pots in order", () => {
    const hand = {
      committed: { a: bb(10), b: bb(20), c: bb(30) },
      foldedPlayerIds: [],
      allInPlayerIds: ["a", "b", "c"]
    } as unknown as HandState;

    const pots = buildPots(hand, 2, bb(1));

    expect(pots.map((pot) => pot.rake)).toEqual([bb(0.6), bb(0.4), 0]);
    expect(pots.reduce((sum, pot) => sum + pot.rake, 0)).toBe(bb(1));
  });

  it("does not reopen betting to an already acted player after a short all-in raise", () => {
    let game = fixedButtonGame(["BTN", "SB", "BB", "UTG"]);

    game = {
      ...game,
      players: game.players.map((player) =>
        player.id === "p-2" ? { ...player, stack: bb(2), profit: player.profit + (bb(2) - player.stack) } : player
      )
    };
    game = applyAction(game, { type: "raise", amount: bb(2) });
    game = applyAction(game, { type: "call" });
    game = applyAction(game, { type: "allIn" });
    game = applyAction(game, { type: "fold" });

    const available = deriveAvailableActions(game);

    expect(game.hand?.currentActorId).toBe("p-4");
    expect(available.callAmount).toBe(bb(0.5));
    expect(available.canRaise).toBe(false);
  });

  it("auto-settles when only one player remains", () => {
    const game = applyAction(fixedButtonGame(), { type: "fold" });

    expect(game.hand?.street).toBe("complete");
    expect(game.lastSettlement?.winners).toEqual([{ potLabel: "Main Pot", playerId: "p-2", amount: bb(1.5) }]);
    expect(game.players.find((player) => player.id === "p-1")?.profit).toBe(-bb(0.5));
    expect(game.players.find((player) => player.id === "p-2")?.profit).toBe(bb(0.5));
  });

  it("keeps profit unchanged during betting and updates it only at settlement", () => {
    let game = fixedButtonGame();

    expect(game.players.map((player) => player.profit)).toEqual([0, 0]);
    game = applyAction(game, { type: "call" });
    expect(game.players.map((player) => player.profit)).toEqual([0, 0]);
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "bet", amount: bb(1) });
    expect(game.players.map((player) => player.profit)).toEqual([0, 0]);
    game = applyAction(game, { type: "fold" });

    expect(game.hand?.street).toBe("complete");
    expect(game.players.find((player) => player.id === "p-1")?.profit).toBe(-bb(1));
    expect(game.players.find((player) => player.id === "p-2")?.profit).toBe(bb(1));
  });

  it("settles a split pot and preserves the whole pot amount", () => {
    let game = fixedButtonGame();
    game = applyAction(game, { type: "call" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });

    expect(game.hand?.street).toBe("showdown");

    const settled = settlePots(game, { "pot-0": ["p-1", "p-2"] });

    expect(settled.lastSettlement?.winners).toHaveLength(2);
    expect(settled.lastSettlement?.winners.reduce((sum, row) => sum + row.amount, 0)).toBe(bb(2));
  });

  it("settles a split pot after subtracting rake from the pot", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let game = createGame({ ...createDefaultConfig(), rakePercent: 10, rakeCap: bb(1) });
    game = applyAction(game, { type: "call" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });
    game = applyAction(game, { type: "check" });

    const settled = settlePots(game, { "pot-0": ["p-1", "p-2"] });

    expect(settled.lastSettlement?.rake).toBe(bb(0.2));
    expect(settled.lastSettlement?.winners.map((row) => row.amount)).toEqual([bb(0.9), bb(0.9)]);
  });

  it("resets stacks each hand in fixed stack mode while keeping profit", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let game = createGame({ ...createDefaultConfig(), mode: "fixed" });
    game = applyAction(game, { type: "fold" });
    const profitBefore = game.players.find((player) => player.id === "p-2")!.profit;
    game = startNextHand(game);

    expect(game.players.find((player) => player.id === "p-2")!.stack).toBe(bb(100) - bb(0.5));
    expect(game.players.find((player) => player.id === "p-2")!.profit).toBe(profitBefore);
  });

  it("skips active players with no chips when starting the next cash hand", () => {
    let game = fixedButtonGame(["A", "B", "C"]);
    game = {
      ...game,
      players: game.players.map((player) => (player.id === "p-1" ? { ...player, stack: 0 } : player)),
      hand: game.hand ? { ...game.hand, street: "complete", currentActorId: undefined } : game.hand
    };

    game = startNextHand(game);
    const available = deriveAvailableActions(game);

    expect(game.players.find((player) => player.id === "p-1")?.status).toBe("active");
    expect(game.hand?.activePlayerIds).toEqual(["p-2", "p-3"]);
    expect(game.hand?.currentActorId).not.toBe("p-1");
    expect(available.playerId).not.toBe("p-1");
  });

  it("stores the completed action log when starting the next hand", () => {
    let game = fixedButtonGame();
    game = applyAction(game, { type: "fold" });

    expect(game.hand?.street).toBe("complete");
    expect(game.hand?.actionLog.length).toBeGreaterThan(0);

    const completedHandNumber = game.hand!.handNumber;
    const completedLogIds = game.hand!.actionLog.map((entry) => entry.id);
    game = startNextHand(game);

    expect(game.previousHandLog?.handNumber).toBe(completedHandNumber);
    expect(game.previousHandLog?.entries.map((entry) => entry.id)).toEqual(completedLogIds);
    expect(game.hand?.handNumber).toBe(completedHandNumber + 1);
  });

  it("adds, removes, and adjusts players without accidental profit changes", () => {
    let game = fixedButtonGame();
    game = addPlayerToGame(game);
    expect(game.players).toHaveLength(3);
    expect(game.players[2].status).toBe("sittingOut");
    expect(game.players[2].pendingStatus).toBe("active");

    game = adjustStack(game, "p-1", bb(125), false);
    expect(game.players.find((player) => player.id === "p-1")?.stack).toBe(bb(125));
    expect(game.players.find((player) => player.id === "p-1")?.profit).toBe(0);

    game = adjustStack(game, "p-1", bb(100), true);
    expect(game.players.find((player) => player.id === "p-1")?.profit).toBe(-bb(25));

    game = removePlayerFromGame(game, "p-3");
    expect(game.players.some((player) => player.id === "p-3")).toBe(false);
  });
});
