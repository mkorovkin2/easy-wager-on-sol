import {
  PublicKey,
  Connection,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Signer,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import BN from 'bn.js';
import { GamePDAs, TokenInfo, PayoutAmounts } from './types';

export const WAGER_PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

/**
 * Derive game and vault PDAs
 */
export function deriveGamePDAs(
  creator: PublicKey,
  nonce: BN,
  mint: PublicKey,
  programId: PublicKey = WAGER_PROGRAM_ID
): GamePDAs {
  // Derive game PDA
  const [gamePda, gameBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('game'),
      creator.toBuffer(),
      nonce.toArrayLike(Buffer, 'le', 8),
    ],
    programId
  );

  let vaultPda: PublicKey | undefined;
  let vaultBump: number | undefined;

  // For SPL tokens, derive vault PDA
  if (!mint.equals(PublicKey.default)) {
    const [vault, bump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('vault'),
        gamePda.toBuffer(),
        mint.toBuffer(),
      ],
      programId
    );
    vaultPda = vault;
    vaultBump = bump;
  }

  return {
    gamePda,
    gameBump,
    vaultPda,
    vaultBump,
  };
}

/**
 * Check if a mint is native SOL
 */
export function isNativeSOL(mint: PublicKey): boolean {
  return mint.equals(PublicKey.default);
}

/**
 * Get token info for a given mint
 */
export async function getTokenInfo(
  connection: Connection,
  mint: PublicKey
): Promise<TokenInfo> {
  if (isNativeSOL(mint)) {
    return {
      mint: PublicKey.default,
      decimals: 9,
      name: 'Solana',
      symbol: 'SOL',
      isNative: true,
    };
  }

  try {
    const mintInfo = await connection.getParsedAccountInfo(mint);
    if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
      const data = mintInfo.value.data.parsed.info;
      return {
        mint,
        decimals: data.decimals,
        isNative: false,
      };
    }
  } catch (error) {
    console.warn('Failed to fetch token info:', error);
  }

  return {
    mint,
    decimals: 9, // Default to 9 decimals if we can't fetch
    isNative: false,
  };
}

/**
 * Calculate payout amounts based on wager and payout basis points
 */
export function calculatePayouts(wager: BN, payoutBps: number): PayoutAmounts {
  const totalPot = wager.muln(2);
  const winnerAmount = totalPot.muln(payoutBps).divn(10000);
  const feeAmount = totalPot.sub(winnerAmount);

  return {
    winnerAmount,
    feeAmount,
    totalPot,
  };
}

/**
 * Get or create Associated Token Account
 */
export async function getOrCreateAssociatedTokenAccount(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false
): Promise<{ address: PublicKey; instruction?: TransactionInstruction }> {
  const associatedToken = getAssociatedTokenAddressSync(
    mint,
    owner,
    allowOwnerOffCurve
  );

  // Check if account already exists
  try {
    const accountInfo = await connection.getAccountInfo(associatedToken);
    if (accountInfo) {
      return { address: associatedToken };
    }
  } catch (error) {
    // Account doesn't exist, we'll create it
  }

  // Create the instruction to create the account
  const instruction = createAssociatedTokenAccountInstruction(
    payer,
    associatedToken,
    owner,
    mint
  );

  return { address: associatedToken, instruction };
}

/**
 * Generate a random nonce for game creation
 */
export function generateNonce(): BN {
  return new BN(Math.floor(Math.random() * 1000000));
}

/**
 * Convert hours to Unix timestamp seconds from now
 */
export function hoursFromNow(hours: number): BN {
  const now = Math.floor(Date.now() / 1000);
  return new BN(now + (hours * 3600));
}

/**
 * Convert Unix timestamp to Date
 */
export function timestampToDate(timestamp: BN): Date {
  return new Date(timestamp.toNumber() * 1000);
}

/**
 * Check if a timestamp is expired
 */
export function isExpired(timestamp: BN): boolean {
  const now = Math.floor(Date.now() / 1000);
  return timestamp.toNumber() <= now;
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: BN, decimals: number): string {
  const divisor = new BN(10).pow(new BN(decimals));
  const quotient = amount.div(divisor);
  const remainder = amount.mod(divisor);
  
  if (remainder.isZero()) {
    return quotient.toString();
  }
  
  const remainderStr = remainder.toString().padStart(decimals, '0');
  const trimmedRemainder = remainderStr.replace(/0+$/, '');
  
  if (trimmedRemainder === '') {
    return quotient.toString();
  }
  
  return `${quotient.toString()}.${trimmedRemainder}`;
}

/**
 * Parse token amount from string to BN
 */
export function parseTokenAmount(amount: string, decimals: number): BN {
  const [integer, fractional = ''] = amount.split('.');
  const fractionalPadded = fractional.padEnd(decimals, '0').slice(0, decimals);
  return new BN(integer + fractionalPadded);
}

/**
 * Validate payout basis points (must be between 1 and 9999)
 */
export function validatePayoutBps(payoutBps: number): void {
  if (payoutBps <= 0 || payoutBps >= 10000) {
    throw new Error('Payout basis points must be between 1 and 9999');
  }
}

/**
 * Create a wrapped SOL account with the specified amount
 */
export async function createWrappedSolAccount(
  connection: Connection,
  payer: Signer,
  owner: PublicKey,
  amount: BN
): Promise<{ address: PublicKey; instructions: TransactionInstruction[] }> {
  const associatedToken = getAssociatedTokenAddressSync(NATIVE_MINT, owner);
  
  const instructions: TransactionInstruction[] = [];
  
  // Check if account exists
  const accountInfo = await connection.getAccountInfo(associatedToken);
  if (!accountInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        associatedToken,
        owner,
        NATIVE_MINT
      )
    );
  }
  
  // Transfer SOL to the account
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: associatedToken,
      lamports: amount.toNumber(),
    })
  );
  
  // Sync native token
  instructions.push(createSyncNativeInstruction(associatedToken));
  
  return { address: associatedToken, instructions };
}

/**
 * Get the minimum rent exempt amount for an account
 */
export async function getMinimumRentExemption(
  connection: Connection,
  dataLength: number
): Promise<BN> {
  const rentExemption = await connection.getMinimumBalanceForRentExemption(dataLength);
  return new BN(rentExemption);
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}
