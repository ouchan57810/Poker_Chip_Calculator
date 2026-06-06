import { GameState } from "./types";
import { reviveGameState, serializeGameState } from "./poker";

const STORAGE_KEY = "poker-chip-calculator-state";
const STALE_MS = 30 * 60 * 1000;

export function loadStoredGame(): GameState | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  const game = reviveGameState(raw);
  if (!game) return undefined;
  if (Date.now() - game.lastHeartbeatAt > STALE_MS) {
    localStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
  return { ...game, lastHeartbeatAt: Date.now() };
}

export function saveStoredGame(game: GameState): void {
  localStorage.setItem(STORAGE_KEY, serializeGameState(game));
}

export function clearStoredGame(): void {
  localStorage.removeItem(STORAGE_KEY);
}
