export type GameMode = "cash" | "fixed";
export type PlayerStatus = "active" | "sittingOut";
export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type TabKey = "table" | "history" | "graph";

export interface GameConfig {
  mode: GameMode;
  startingStack: number;
  rakePercent: number;
  rakeCap: number;
  playerNames: string[];
}

export interface PlayerState {
  id: string;
  seat: number;
  name: string;
  stack: number;
  profit: number;
  status: PlayerStatus;
  pendingStatus?: PlayerStatus;
  pendingRemoval?: boolean;
}

export interface ActionLogEntry {
  id: string;
  handNumber: number;
  street: Street;
  playerId: string;
  position: string;
  playerName: string;
  label: string;
  amount?: number;
}

export interface Pot {
  id: string;
  label: string;
  amount: number;
  eligiblePlayerIds: string[];
  rake: number;
}

export interface HandState {
  id: string;
  handNumber: number;
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  street: Street;
  currentActorId?: string;
  activePlayerIds: string[];
  foldedPlayerIds: string[];
  allInPlayerIds: string[];
  actedPlayerIds: string[];
  canRaisePlayerIds: string[];
  streetBets: Record<string, number>;
  committed: Record<string, number>;
  currentBet: number;
  lastFullRaise: number;
  lastFullRaiseTo: number;
  actionLog: ActionLogEntry[];
  pots: Pot[];
  displayPots: Pot[];
  settlementPots: Pot[];
}

export interface ProfitSnapshot {
  handNumber: number;
  profits: Record<string, number>;
}

export interface SettlementResult {
  handNumber: number;
  winners: { potLabel: string; playerId: string; amount: number }[];
  rake: number;
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  handNumber: number;
  buttonSeat: number;
  hand?: HandState;
  graph: ProfitSnapshot[];
  lastSettlement?: SettlementResult;
  lastHeartbeatAt: number;
}

export type PlayerAction =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; amount: number }
  | { type: "raise"; amount: number }
  | { type: "allIn" };

export interface AvailableActions {
  playerId?: string;
  callAmount: number;
  minBet: number;
  minRaiseTo: number;
  maxTotal: number;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  canFold: boolean;
}
