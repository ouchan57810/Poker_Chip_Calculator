import { BB_UNIT, SB, bb, clamp } from "./money";
import {
  ActionLogEntry,
  AvailableActions,
  GameConfig,
  GameState,
  HandState,
  PlayerAction,
  PlayerState,
  PlayerStatus,
  Pot,
  SettlementResult,
  Street
} from "./types";

const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

export function createDefaultConfig(): GameConfig {
  return {
    mode: "cash",
    startingStack: bb(100),
    rakePercent: 0,
    rakeCap: 0,
    playerNames: ["Player 1", "Player 2"]
  };
}

export function createGame(config: GameConfig): GameState {
  const sanitizedNames = config.playerNames.slice(0, 9).map((name, index) => name.trim() || `Player ${index + 1}`);
  const players: PlayerState[] = sanitizedNames.map((name, seat) => ({
    id: `p-${seat + 1}`,
    seat,
    name,
    stack: config.startingStack,
    profit: 0,
    status: "active"
  }));
  const initialButton = Math.floor(Math.random() * players.length);
  const game: GameState = {
    config: { ...config, playerNames: sanitizedNames },
    players,
    handNumber: 0,
    buttonSeat: initialButton,
    graph: [],
    lastHeartbeatAt: Date.now()
  };
  return startHand(game, initialButton);
}

export function serializeGameState(game: GameState): string {
  return JSON.stringify({ ...game, lastHeartbeatAt: Date.now() });
}

export function reviveGameState(raw: string): GameState | undefined {
  try {
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed.players || !parsed.config || parsed.config.startingStack > bb(1000)) return undefined;
    if (parsed.hand && !parsed.hand.handNet) return undefined;
    return {
      ...parsed,
      previousHandLog: parsed.previousHandLog
        ? {
            handNumber: parsed.previousHandLog.handNumber,
            entries: parsed.previousHandLog.entries ?? []
          }
        : undefined
    };
  } catch {
    return undefined;
  }
}

export function startHand(game: GameState, buttonSeat = nextActiveSeat(game.players, game.buttonSeat - 1)): GameState {
  const players = removePendingPlayers(applyPendingStatuses(game.players)).map((player) => {
    if (game.config.mode === "fixed" && player.status === "active") {
      return { ...player, stack: game.config.startingStack };
    }
    return player;
  });
  const activePlayers = players.filter((player) => player.status === "active");
  if (activePlayers.length < 2) {
    return { ...game, players, hand: undefined, lastSettlement: undefined, lastHeartbeatAt: Date.now() };
  }

  const resolvedButton = normalizeButtonSeat(players, buttonSeat);
  const isHeadsUp = activePlayers.length === 2;
  const smallBlindSeat = isHeadsUp ? resolvedButton : nextActiveSeat(players, resolvedButton);
  const bigBlindSeat = nextActiveSeat(players, smallBlindSeat);
  const handNumber = game.handNumber + 1;
  const activePlayerIds = activePlayers.map((player) => player.id);
  const blankAmounts = Object.fromEntries(activePlayers.map((player) => [player.id, 0]));

  let nextPlayers = players;
  let streetBets = { ...blankAmounts };
  let committed = { ...blankAmounts };
  let handNet = { ...blankAmounts };
  const actionLog: ActionLogEntry[] = [];
  const allInPlayerIds: string[] = [];

  const postBlind = (seat: number, blindAmount: number, label: string) => {
    const player = nextPlayers.find((candidate) => candidate.seat === seat);
    if (!player || player.status !== "active") return;
    const amount = Math.min(player.stack, blindAmount);
    nextPlayers = moveChips(nextPlayers, player.id, -amount);
    streetBets = { ...streetBets, [player.id]: amount };
    committed = { ...committed, [player.id]: amount };
    handNet = { ...handNet, [player.id]: (handNet[player.id] ?? 0) - amount };
    if (amount > 0 && amount === player.stack) allInPlayerIds.push(player.id);
    actionLog.push(logEntry(handNumber, "preflop", player, positionForSeat(players, resolvedButton, player.seat), label, amount));
  };

  postBlind(smallBlindSeat, SB, "SB");
  postBlind(bigBlindSeat, BB_UNIT, "BB");

  const firstActorSeat = isHeadsUp ? smallBlindSeat : nextActiveSeat(nextPlayers, bigBlindSeat);
  const firstActor = nextPlayers.find((player) => player.seat === firstActorSeat && player.status === "active" && player.stack > 0);
  const pots = buildPotsFromState(committed, [], allInPlayerIds, game.config.rakePercent, game.config.rakeCap);
  const hand: HandState = {
    id: `hand-${handNumber}`,
    handNumber,
    buttonSeat: resolvedButton,
    smallBlindSeat,
    bigBlindSeat,
    street: "preflop",
    currentActorId: firstActor?.id,
    activePlayerIds,
    foldedPlayerIds: [],
    allInPlayerIds,
    actedPlayerIds: [],
    canRaisePlayerIds: activePlayerIds.filter((id) => !allInPlayerIds.includes(id)),
    streetBets,
    committed,
    handNet,
    currentBet: Math.max(...Object.values(streetBets)),
    lastFullRaise: BB_UNIT,
    lastFullRaiseTo: Math.max(...Object.values(streetBets)),
    actionLog,
    pots,
    displayPots: pots,
    settlementPots: pots
  };

  return normalizeGameProgress({
    ...game,
    players: nextPlayers,
    handNumber,
    buttonSeat: resolvedButton,
    hand,
    lastSettlement: undefined,
    lastHeartbeatAt: Date.now()
  });
}

export function startNextHand(game: GameState): GameState {
  const nextPlayers = removePendingPlayers(applyPendingStatuses(game.players));
  const nextButton = nextActiveSeat(nextPlayers, game.buttonSeat);
  const previousHandLog = game.hand
    ? {
        handNumber: game.hand.handNumber,
        entries: [...game.hand.actionLog]
      }
    : game.previousHandLog;
  return startHand({ ...game, players: nextPlayers, buttonSeat: nextButton, hand: undefined, previousHandLog, lastSettlement: undefined }, nextButton);
}

export function deriveAvailableActions(game: GameState): AvailableActions {
  const hand = game.hand;
  const player = hand?.currentActorId ? game.players.find((candidate) => candidate.id === hand.currentActorId) : undefined;
  if (!hand || !player || hand.street === "showdown" || hand.street === "complete") {
    return emptyActions();
  }
  const streetBet = hand.streetBets[player.id] ?? 0;
  const callAmount = Math.max(0, hand.currentBet - streetBet);
  const maxTotal = streetBet + player.stack;
  const minRaiseTo = hand.currentBet + hand.lastFullRaise;
  return {
    playerId: player.id,
    callAmount: Math.min(callAmount, player.stack),
    minBet: Math.min(BB_UNIT, maxTotal),
    minRaiseTo: Math.min(minRaiseTo, maxTotal),
    maxTotal,
    canCheck: callAmount === 0,
    canCall: callAmount > 0 && player.stack > 0,
    canBet: hand.currentBet === 0 && player.stack > 0,
    canRaise: hand.currentBet > 0 && player.stack > callAmount && hand.canRaisePlayerIds.includes(player.id),
    canFold: callAmount > 0
  };
}

export function applyAction(game: GameState, action: PlayerAction): GameState {
  const hand = game.hand;
  if (!hand?.currentActorId || hand.street === "showdown" || hand.street === "complete") return game;
  const player = game.players.find((candidate) => candidate.id === hand.currentActorId);
  if (!player) return game;

  const available = deriveAvailableActions(game);
  let players = game.players;
  let nextHand = cloneHand(hand);
  const streetBet = nextHand.streetBets[player.id] ?? 0;
  const callAmount = Math.max(0, nextHand.currentBet - streetBet);

  const commit = (targetTotal: number) => {
    const boundedTotal = clamp(targetTotal, streetBet, streetBet + player.stack);
    const delta = boundedTotal - streetBet;
    players = moveChips(players, player.id, -delta);
    nextHand.streetBets[player.id] = boundedTotal;
    nextHand.committed[player.id] = (nextHand.committed[player.id] ?? 0) + delta;
    nextHand.handNet[player.id] = (nextHand.handNet[player.id] ?? 0) - delta;
    const updated = players.find((candidate) => candidate.id === player.id);
    if (updated && updated.stack === 0 && !nextHand.allInPlayerIds.includes(player.id)) {
      nextHand.allInPlayerIds.push(player.id);
    }
    return { boundedTotal, delta, allIn: Boolean(updated && updated.stack === 0) };
  };

  const markActed = () => {
    nextHand.actedPlayerIds = unique([...nextHand.actedPlayerIds, player.id]);
    nextHand.canRaisePlayerIds = nextHand.canRaisePlayerIds.filter((id) => id !== player.id);
  };

  if (action.type === "fold" && available.canFold) {
    nextHand.foldedPlayerIds = unique([...nextHand.foldedPlayerIds, player.id]);
    nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), "Fold"));
    markActed();
  }

  if (action.type === "check" && available.canCheck) {
    nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), "Check"));
    markActed();
  }

  if (action.type === "call" && available.canCall) {
    const { delta, allIn } = commit(streetBet + callAmount);
    nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), allIn ? "Call All in" : "Call", delta));
    markActed();
  }

  if (action.type === "bet" && available.canBet) {
    const desired = action.amount;
    const target = desired >= player.stack + streetBet ? player.stack + streetBet : Math.max(desired, BB_UNIT);
    const { boundedTotal, allIn } = commit(target);
    const isFullBet = boundedTotal >= BB_UNIT;
    nextHand.currentBet = Math.max(nextHand.currentBet, boundedTotal);
    if (isFullBet) {
      nextHand.lastFullRaise = boundedTotal;
      nextHand.lastFullRaiseTo = boundedTotal;
      nextHand.actedPlayerIds = [player.id];
      nextHand.canRaisePlayerIds = bettingPlayerIds(players, nextHand).filter((id) => id !== player.id);
    } else {
      markActed();
    }
    nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), allIn ? "Bet All in" : "Bet", boundedTotal));
  }

  if (action.type === "raise" && available.canRaise) {
    const desired = action.amount;
    const allInTotal = player.stack + streetBet;
    const minRaiseTo = nextHand.currentBet + nextHand.lastFullRaise;
    const target = desired >= allInTotal ? allInTotal : Math.max(desired, minRaiseTo);
    const previousBet = nextHand.currentBet;
    const { boundedTotal, allIn } = commit(target);
    nextHand.currentBet = Math.max(nextHand.currentBet, boundedTotal);
    const raiseSize = boundedTotal - previousBet;
    if (raiseSize >= nextHand.lastFullRaise) {
      nextHand.lastFullRaise = raiseSize;
      nextHand.lastFullRaiseTo = boundedTotal;
      nextHand.actedPlayerIds = [player.id];
      nextHand.canRaisePlayerIds = bettingPlayerIds(players, nextHand).filter((id) => id !== player.id);
    } else if (boundedTotal - nextHand.lastFullRaiseTo >= nextHand.lastFullRaise) {
      nextHand.actedPlayerIds = [player.id];
      nextHand.canRaisePlayerIds = bettingPlayerIds(players, nextHand).filter((id) => id !== player.id);
    } else {
      markActed();
    }
    nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), allIn ? "Raise All in" : "Raise", boundedTotal));
  }

  if (action.type === "allIn") {
    const allInTotal = streetBet + player.stack;
    const isBet = nextHand.currentBet === 0;
    const previousBet = nextHand.currentBet;
    const { boundedTotal } = commit(allInTotal);
    if (isBet) {
      nextHand.currentBet = Math.max(nextHand.currentBet, boundedTotal);
      if (boundedTotal >= BB_UNIT) {
        nextHand.lastFullRaise = boundedTotal;
        nextHand.lastFullRaiseTo = boundedTotal;
        nextHand.actedPlayerIds = [player.id];
        nextHand.canRaisePlayerIds = bettingPlayerIds(players, nextHand).filter((id) => id !== player.id);
      } else {
        markActed();
      }
      nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), "Bet All in", boundedTotal));
    } else if (boundedTotal > previousBet) {
      nextHand.currentBet = boundedTotal;
      const raiseSize = boundedTotal - previousBet;
      if (raiseSize >= nextHand.lastFullRaise) {
        nextHand.lastFullRaise = raiseSize;
        nextHand.lastFullRaiseTo = boundedTotal;
        nextHand.actedPlayerIds = [player.id];
        nextHand.canRaisePlayerIds = bettingPlayerIds(players, nextHand).filter((id) => id !== player.id);
      } else if (boundedTotal - nextHand.lastFullRaiseTo >= nextHand.lastFullRaise) {
        nextHand.actedPlayerIds = [player.id];
        nextHand.canRaisePlayerIds = bettingPlayerIds(players, nextHand).filter((id) => id !== player.id);
      } else {
        markActed();
      }
      nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), "Raise All in", boundedTotal));
    } else {
      nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(players, nextHand.buttonSeat, player.seat), "Call All in", boundedTotal - streetBet));
      markActed();
    }
  }

  nextHand = withFreshPots(nextHand, game.config);
  return normalizeGameProgress({ ...game, players, hand: nextHand, lastHeartbeatAt: Date.now() });
}

export function settlePots(game: GameState, winnersByPot: Record<string, string[]>): GameState {
  const hand = game.hand;
  if (!hand || hand.street !== "showdown") return game;
  return completeHand(game, hand, winnersByPot);
}

export function updatePlayerName(game: GameState, playerId: string, name: string): GameState {
  return { ...game, players: game.players.map((player) => (player.id === playerId ? { ...player, name } : player)) };
}

export function adjustStack(game: GameState, playerId: string, newStack: number, adjustProfit: boolean): GameState {
  return {
    ...game,
    players: game.players.map((player) => {
      if (player.id !== playerId) return player;
      const safeStack = Math.max(0, newStack);
      const diff = safeStack - player.stack;
      return { ...player, stack: safeStack, profit: adjustProfit ? player.profit + diff : player.profit };
    })
  };
}

export function addPlayerToGame(game: GameState, name?: string): GameState {
  if (game.players.length >= 9) return game;
  const usedSeats = new Set(game.players.map((player) => player.seat));
  let seat = 0;
  while (usedSeats.has(seat)) seat += 1;
  const nextNumber = Math.max(0, ...game.players.map((player) => Number(player.id.replace("p-", "")) || 0)) + 1;
  const handInProgress = game.hand && !["complete", "showdown"].includes(game.hand.street);
  const player: PlayerState = {
    id: `p-${nextNumber}`,
    seat,
    name: name?.trim() || `Player ${nextNumber}`,
    stack: game.config.startingStack,
    profit: 0,
    status: handInProgress ? "sittingOut" : "active",
    pendingStatus: handInProgress ? "active" : undefined
  };
  return { ...game, players: [...game.players, player] };
}

export function requestPlayerStatus(game: GameState, playerId: string, status: PlayerStatus): GameState {
  const handInProgress = game.hand && !["complete", "showdown"].includes(game.hand.street);
  return {
    ...game,
    players: game.players.map((player) => {
      if (player.id !== playerId) return player;
      if (!handInProgress) return { ...player, status, pendingStatus: undefined };
      return { ...player, pendingStatus: status };
    })
  };
}

export function removePlayerFromGame(game: GameState, playerId: string): GameState {
  const hand = game.hand;
  if (!hand || ["complete", "showdown"].includes(hand.street) || !hand.activePlayerIds.includes(playerId)) {
    return { ...game, players: game.players.filter((player) => player.id !== playerId) };
  }
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) return game;
  let nextHand = cloneHand(hand);
  if (!nextHand.allInPlayerIds.includes(playerId)) {
    nextHand.foldedPlayerIds = unique([...nextHand.foldedPlayerIds, playerId]);
    nextHand.actedPlayerIds = unique([...nextHand.actedPlayerIds, playerId]);
    nextHand.actionLog.push(logEntry(nextHand.handNumber, nextHand.street, player, positionForSeat(game.players, nextHand.buttonSeat, player.seat), "Fold"));
  }
  nextHand.canRaisePlayerIds = nextHand.canRaisePlayerIds.filter((id) => id !== playerId);
  nextHand.currentActorId = nextHand.currentActorId === playerId ? undefined : nextHand.currentActorId;
  nextHand = withFreshPots(nextHand, game.config);
  return normalizeGameProgress({
    ...game,
    players: game.players.map((candidate) => (candidate.id === playerId ? { ...candidate, pendingRemoval: true } : candidate)),
    hand: nextHand
  });
}

export function resetToSetup(game: GameState): GameState {
  return { ...game, hand: undefined, lastHeartbeatAt: 0 };
}

export function positionForSeat(players: PlayerState[], buttonSeat: number, seat: number): string {
  const active = players.filter((player) => player.status === "active" && !player.pendingRemoval).sort((a, b) => a.seat - b.seat);
  const count = active.length;
  if (count === 0) return "-";
  if (count === 2) {
    return seat === buttonSeat ? "SB" : "BB";
  }
  const buttonIndex = active.findIndex((player) => player.seat === buttonSeat);
  const offset = (active.findIndex((player) => player.seat === seat) - buttonIndex + count) % count;
  if (offset === 0) return "BTN";
  if (offset === 1) return "SB";
  if (offset === 2) return "BB";
  const names: Record<number, string[]> = {
    3: ["BTN", "SB", "BB"],
    4: ["BTN", "SB", "BB", "UTG"],
    5: ["BTN", "SB", "BB", "UTG", "CO"],
    6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
    7: ["BTN", "SB", "BB", "UTG", "LJ", "HJ", "CO"],
    8: ["BTN", "SB", "BB", "UTG", "UTG+1", "LJ", "HJ", "CO"],
    9: ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"]
  };
  return names[count]?.[offset] ?? `P${offset}`;
}

export function buildPots(hand: HandState, rakePercent: number, rakeCap: number): Pot[] {
  return buildPotsFromState(hand.committed, hand.foldedPlayerIds, hand.allInPlayerIds, rakePercent, rakeCap);
}

function normalizeGameProgress(game: GameState): GameState {
  const hand = game.hand;
  if (!hand) return game;
  const remaining = livePlayerIds(hand);
  if (remaining.length === 1) {
    const winnerId = remaining[0];
    return completeHand(game, { ...hand, currentActorId: undefined, ...freshPotFields(hand, game.config) }, Object.fromEntries(hand.displayPots.map((pot) => [pot.id, [winnerId]])));
  }
  if (remaining.length > 1 && remaining.every((id) => hand.allInPlayerIds.includes(id))) {
    return { ...game, hand: { ...hand, street: "showdown", currentActorId: undefined, ...freshPotFields(hand, game.config) } };
  }
  if (isBettingRoundComplete(game.players, hand)) {
    return { ...game, hand: advanceStreet(game.players, hand, game.config) };
  }
  if (hand.currentActorId && needsAction(hand.currentActorId, hand)) {
    return game;
  }
  const nextActorId = findNextActor(game.players, hand, hand.currentActorId);
  return { ...game, hand: { ...hand, currentActorId: nextActorId } };
}

export function advanceStreet(players: PlayerState[], hand: HandState, config: GameConfig): HandState {
  const index = STREETS.indexOf(hand.street);
  if (index === -1 || index === STREETS.length - 1) {
    return { ...hand, street: "showdown", currentActorId: undefined, ...freshPotFields(hand, config) };
  }
  const nextStreet = STREETS[index + 1];
  const liveIds = livePlayerIds(hand);
  const streetBets = Object.fromEntries(hand.activePlayerIds.map((id) => [id, 0]));
  const firstActorId = firstPostflopActor(players, hand, liveIds);
  return {
    ...hand,
    street: nextStreet,
    currentActorId: firstActorId,
    streetBets,
    currentBet: 0,
    lastFullRaise: BB_UNIT,
    lastFullRaiseTo: 0,
    actedPlayerIds: [],
    canRaisePlayerIds: bettingPlayerIds(players, { ...hand, streetBets, currentBet: 0 }).filter((id) => liveIds.includes(id)),
    ...freshPotFields({ ...hand, streetBets }, config)
  };
}

function completeHand(game: GameState, sourceHand: HandState, winnersByPot: Record<string, string[]>): GameState {
  const hand = withFreshPots(sourceHand, game.config);
  let players = game.players;
  const handNet = { ...hand.handNet };
  const winnerRows: SettlementResult["winners"] = [];
  let totalRake = 0;
  const order = orderedSeatsAfterButton(players, hand.buttonSeat);

  for (const pot of hand.displayPots) {
    const selectedWinners = winnersByPot[pot.id] ?? [];
    const winners = (pot.eligiblePlayerIds.length === 1 ? pot.eligiblePlayerIds : selectedWinners).filter((id) => pot.eligiblePlayerIds.includes(id));
    if (winners.length === 0) continue;
    totalRake += pot.rake;
    const net = Math.max(0, pot.amount - pot.rake);
    const base = Math.floor(net / winners.length);
    let remainder = net - base * winners.length;
    const sortedWinners = winners.slice().sort((a, b) => order.indexOf(playerSeat(players, a)) - order.indexOf(playerSeat(players, b)));
    for (const winnerId of sortedWinners) {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const amount = base + extra;
      players = moveChips(players, winnerId, amount);
      handNet[winnerId] = (handNet[winnerId] ?? 0) + amount;
      winnerRows.push({ potLabel: pot.label, playerId: winnerId, amount });
    }
  }

  players = removePendingPlayers(applyHandNetToProfit(players, handNet));
  const completeHandState: HandState = { ...hand, handNet, street: "complete", currentActorId: undefined };
  const graph = [
    ...game.graph,
    {
      handNumber: hand.handNumber,
      profits: Object.fromEntries(players.map((player) => [player.id, player.profit]))
    }
  ];
  return {
    ...game,
    players,
    hand: completeHandState,
    graph,
    lastSettlement: { handNumber: hand.handNumber, winners: winnerRows, rake: totalRake },
    lastHeartbeatAt: Date.now()
  };
}

function withFreshPots(hand: HandState, config: GameConfig): HandState {
  return { ...hand, ...freshPotFields(hand, config) };
}

function freshPotFields(hand: HandState, config: GameConfig): Pick<HandState, "pots" | "displayPots" | "settlementPots"> {
  const displayPots = buildPotsFromState(hand.committed, hand.foldedPlayerIds, hand.allInPlayerIds, config.rakePercent, config.rakeCap);
  const settlementPots = displayPots.filter((pot) => pot.eligiblePlayerIds.length > 1);
  return { pots: displayPots, displayPots, settlementPots };
}

function buildPotsFromState(
  committed: Record<string, number>,
  foldedPlayerIds: string[],
  allInPlayerIds: string[],
  rakePercent: number,
  rakeCap: number
): Pot[] {
  const entries = Object.entries(committed).filter(([, amount]) => amount > 0);
  const maxCommitted = Math.max(0, ...entries.map(([, amount]) => amount));
  if (maxCommitted === 0) return [];
  const allInLevels = allInPlayerIds.map((id) => committed[id] ?? 0).filter((amount) => amount > 0);
  const levels = unique([...allInLevels, maxCommitted]).sort((a, b) => a - b);
  const grossPots: Omit<Pot, "rake">[] = [];
  let previous = 0;

  for (const level of levels) {
    const contributors = entries.filter(([, amount]) => amount > previous);
    const amount = contributors.reduce((sum, [, committedAmount]) => sum + Math.max(0, Math.min(committedAmount, level) - previous), 0);
    const hasAllInBoundary = allInLevels.length > 0;
    const eligiblePlayerIds = contributors
      .filter(([id, committedAmount]) => !foldedPlayerIds.includes(id) && (!hasAllInBoundary || committedAmount >= level))
      .map(([id]) => id);
    if (amount > 0 && eligiblePlayerIds.length > 0) {
      grossPots.push({
        id: `pot-${grossPots.length}`,
        label: grossPots.length === 0 ? "Main Pot" : `Side Pot ${grossPots.length}`,
        amount,
        eligiblePlayerIds
      });
    }
    previous = level;
  }

  let remainingRakeCap = Math.max(0, rakeCap);
  return grossPots.map((pot) => {
    const naturalRake = Math.max(0, Math.round(pot.amount * (Math.max(0, rakePercent) / 100)));
    const rake = Math.min(naturalRake, remainingRakeCap);
    remainingRakeCap -= rake;
    return { ...pot, rake };
  });
}

function isBettingRoundComplete(players: PlayerState[], hand: HandState): boolean {
  const actors = bettingPlayerIds(players, hand);
  if (actors.length === 0) return true;
  return actors.every((id) => hand.actedPlayerIds.includes(id) && (hand.streetBets[id] ?? 0) === hand.currentBet);
}

function needsAction(playerId: string, hand: HandState): boolean {
  if (hand.foldedPlayerIds.includes(playerId) || hand.allInPlayerIds.includes(playerId)) return false;
  return !hand.actedPlayerIds.includes(playerId) || (hand.streetBets[playerId] ?? 0) < hand.currentBet;
}

function findNextActor(players: PlayerState[], hand: HandState, currentActorId?: string): string | undefined {
  const actors = bettingPlayerIds(players, hand);
  if (actors.length === 0) return undefined;
  const startSeat = currentActorId ? playerSeat(players, currentActorId) : hand.buttonSeat;
  const ordered = orderedSeatsAfter(players, startSeat);
  const nextSeat = ordered.find((seat) => {
    const player = players.find((candidate) => candidate.seat === seat);
    if (!player || !actors.includes(player.id)) return false;
    if ((hand.streetBets[player.id] ?? 0) < hand.currentBet) return true;
    return !hand.actedPlayerIds.includes(player.id);
  });
  return players.find((player) => player.seat === nextSeat)?.id;
}

function firstPostflopActor(players: PlayerState[], hand: HandState, liveIds: string[]): string | undefined {
  const ordered = orderedSeatsAfterButton(players, hand.buttonSeat);
  const seat = ordered.find((candidateSeat) => {
    const player = players.find((candidate) => candidate.seat === candidateSeat);
    return player && liveIds.includes(player.id) && !hand.allInPlayerIds.includes(player.id);
  });
  return players.find((player) => player.seat === seat)?.id;
}

function bettingPlayerIds(players: PlayerState[], hand: HandState): string[] {
  return hand.activePlayerIds.filter((id) => {
    const player = players.find((candidate) => candidate.id === id);
    return Boolean(player && player.status === "active" && !player.pendingRemoval && !hand.foldedPlayerIds.includes(id) && !hand.allInPlayerIds.includes(id));
  });
}

function livePlayerIds(hand: HandState): string[] {
  return hand.activePlayerIds.filter((id) => !hand.foldedPlayerIds.includes(id));
}

function moveChips(players: PlayerState[], playerId: string, delta: number): PlayerState[] {
  return players.map((player) => {
    if (player.id !== playerId) return player;
    return { ...player, stack: Math.max(0, player.stack + delta) };
  });
}

function applyHandNetToProfit(players: PlayerState[], handNet: Record<string, number>): PlayerState[] {
  return players.map((player) => ({ ...player, profit: player.profit + (handNet[player.id] ?? 0) }));
}

function applyPendingStatuses(players: PlayerState[]): PlayerState[] {
  return players.map((player) => (player.pendingStatus ? { ...player, status: player.pendingStatus, pendingStatus: undefined } : player));
}

function removePendingPlayers(players: PlayerState[]): PlayerState[] {
  return players.filter((player) => !player.pendingRemoval);
}

function normalizeButtonSeat(players: PlayerState[], requestedSeat: number): number {
  const requested = players.find((player) => player.seat === requestedSeat && player.status === "active" && !player.pendingRemoval);
  return requested ? requested.seat : nextActiveSeat(players, requestedSeat - 1);
}

function nextActiveSeat(players: PlayerState[], fromSeat: number): number {
  const active = players.filter((player) => player.status === "active" && !player.pendingRemoval).sort((a, b) => a.seat - b.seat);
  if (active.length === 0) return 0;
  const candidate = active.find((player) => player.seat > fromSeat);
  return candidate?.seat ?? active[0].seat;
}

function orderedSeatsAfterButton(players: PlayerState[], buttonSeat: number): number[] {
  return orderedSeatsAfter(players, buttonSeat);
}

function orderedSeatsAfter(players: PlayerState[], seat: number): number[] {
  const activeSeats = players.filter((player) => player.status === "active" && !player.pendingRemoval).map((player) => player.seat).sort((a, b) => a - b);
  return [...activeSeats.filter((candidate) => candidate > seat), ...activeSeats.filter((candidate) => candidate <= seat)];
}

function playerSeat(players: PlayerState[], playerId: string): number {
  return players.find((player) => player.id === playerId)?.seat ?? 0;
}

function logEntry(handNumber: number, street: Street, player: PlayerState, position: string, label: string, amount?: number): ActionLogEntry {
  return {
    id: `${handNumber}-${street}-${player.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    handNumber,
    street,
    playerId: player.id,
    playerName: player.name,
    position,
    label,
    amount
  };
}

function cloneHand(hand: HandState): HandState {
  return {
    ...hand,
    foldedPlayerIds: [...hand.foldedPlayerIds],
    allInPlayerIds: [...hand.allInPlayerIds],
    actedPlayerIds: [...hand.actedPlayerIds],
    canRaisePlayerIds: [...hand.canRaisePlayerIds],
    streetBets: { ...hand.streetBets },
    committed: { ...hand.committed },
    handNet: { ...hand.handNet },
    actionLog: [...hand.actionLog],
    pots: hand.pots.map(clonePot),
    displayPots: hand.displayPots.map(clonePot),
    settlementPots: hand.settlementPots.map(clonePot)
  };
}

function clonePot(pot: Pot): Pot {
  return { ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] };
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function emptyActions(): AvailableActions {
  return {
    callAmount: 0,
    minBet: 0,
    minRaiseTo: 0,
    maxTotal: 0,
    canCheck: false,
    canCall: false,
    canBet: false,
    canRaise: false,
    canFold: false
  };
}
