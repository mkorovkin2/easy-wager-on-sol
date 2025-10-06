import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export interface GameAccount {
  creator: PublicKey;
  player1: PublicKey;
  player2: PublicKey;
  resolver: PublicKey;
  devWallet: PublicKey;
  mint: PublicKey;
  wager: BN;
  payoutBps: number;
  state: GameState;
  expiryTs: BN;
  nonce: BN;
  bump: number;
  vaultBump: number;

  // Helper methods
  isNativeSOL(): boolean;
  canJoin(): boolean;
  canResolve(): boolean;
  isExpired(): boolean;
}

export enum GameState {
  Open = 0,
  Ready = 1,
  Paid = 2,
  Canceled = 3,
  Expired = 4,
}

export interface CreateGameArgs {
  mint: PublicKey;
  wager: BN;
  payoutBps: number;
  expiryTs: BN;
  resolverPubkey?: PublicKey;
  devWallet: PublicKey;
  nonce?: BN;
}

export interface GamePDAs {
  gamePda: PublicKey;
  gameBump: number;
  vaultPda?: PublicKey;
  vaultBump?: number;
}

export interface PayoutAmounts {
  winnerAmount: BN;
  feeAmount: BN;
  totalPot: BN;
}

export interface WagerConfig {
  minWager?: BN;
  maxWager?: BN;
  minPayoutBps?: number;
  maxPayoutBps?: number;
  defaultExpiryHours?: number;
}

export interface TokenInfo {
  mint: PublicKey;
  decimals: number;
  name?: string;
  symbol?: string;
  isNative: boolean;
}

// Event types for parsing logs
export interface GameCreatedEvent {
  game: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  wager: BN;
  payoutBps: number;
  expiryTs: BN;
}

export interface GameJoinedEvent {
  game: PublicKey;
  player1: PublicKey;
  player2: PublicKey;
}

export interface GameResolvedEvent {
  game: PublicKey;
  winner: PublicKey;
  winnerAmount: BN;
  feeAmount: BN;
}

export interface GameCanceledEvent {
  game: PublicKey;
  reason: string;
}

// SDK Client configuration
export interface WagerClientConfig {
  programId?: PublicKey;
  cluster?: 'devnet' | 'testnet' | 'mainnet-beta' | 'localnet';
  confirmOptions?: {
    commitment?: 'processed' | 'confirmed' | 'finalized';
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
    maxRetries?: number;
  };
}

// Error types
export class WagerError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'WagerError';
  }
}

export class InsufficientFundsError extends WagerError {
  constructor(required: BN, available: BN) {
    super(`Insufficient funds: required ${required.toString()}, available ${available.toString()}`);
    this.name = 'InsufficientFundsError';
  }
}

export class GameNotFoundError extends WagerError {
  constructor(gamePda: PublicKey) {
    super(`Game not found: ${gamePda.toString()}`);
    this.name = 'GameNotFoundError';
  }
}

export class InvalidGameStateError extends WagerError {
  constructor(expected: GameState, actual: GameState) {
    super(`Invalid game state: expected ${GameState[expected]}, got ${GameState[actual]}`);
    this.name = 'InvalidGameStateError';
  }
}
