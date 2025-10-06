import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  Connection,
  Signer,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  CreateGameArgs,
  GamePDAs,
  WagerError,
} from './types';
import {
  WAGER_PROGRAM_ID,
  deriveGamePDAs,
  isNativeSOL,
  getOrCreateAssociatedTokenAccount,
  validatePayoutBps,
  generateNonce,
} from './utils';

/**
 * Create a new game instruction
 */
export async function createCreateGameInstruction(
  connection: Connection,
  creator: PublicKey,
  args: CreateGameArgs,
  programId: PublicKey = WAGER_PROGRAM_ID
): Promise<{
  instruction: TransactionInstruction;
  gamePda: PublicKey;
  preInstructions: TransactionInstruction[];
}> {
  validatePayoutBps(args.payoutBps);

  const nonce = args.nonce || generateNonce();
  const { gamePda, vaultPda } = deriveGamePDAs(creator, nonce, args.mint, programId);

  const preInstructions: TransactionInstruction[] = [];
  const accounts: any = {
    creator,
    game: gamePda,
    devWallet: args.devWallet,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  };

  // For SPL tokens, add vault and mint accounts
  if (!isNativeSOL(args.mint)) {
    if (!vaultPda) {
      throw new WagerError('Vault PDA is required for SPL tokens');
    }
    accounts.vault = vaultPda;
    accounts.tokenMint = args.mint;
  } else {
    accounts.vault = null;
    accounts.tokenMint = null;
  }

  const data = Buffer.concat([
    Buffer.from([0]), // create_game discriminator (placeholder)
    args.mint.toBuffer(),
    args.wager.toArrayLike(Buffer, 'le', 8),
    Buffer.from([args.payoutBps & 0xff, (args.payoutBps >> 8) & 0xff]),
    args.expiryTs.toArrayLike(Buffer, 'le', 8),
    Buffer.from([args.resolverPubkey ? 1 : 0]),
    args.resolverPubkey ? args.resolverPubkey.toBuffer() : Buffer.alloc(32),
    nonce.toArrayLike(Buffer, 'le', 8),
  ]);

  // Build instruction manually since we don't have the IDL
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: gamePda, isSigner: false, isWritable: true },
      ...(vaultPda ? [{ pubkey: vaultPda, isSigner: false, isWritable: true }] : []),
      ...(isNativeSOL(args.mint) ? [] : [{ pubkey: args.mint, isSigner: false, isWritable: false }]),
      { pubkey: args.devWallet, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });

  return {
    instruction,
    gamePda,
    preInstructions,
  };
}

/**
 * Create join game instruction
 */
export async function createJoinGameInstruction(
  connection: Connection,
  player2: PublicKey,
  gamePda: PublicKey,
  gameAccount: any, // Game account data
  programId: PublicKey = WAGER_PROGRAM_ID
): Promise<{
  instruction: TransactionInstruction;
  preInstructions: TransactionInstruction[];
}> {
  const preInstructions: TransactionInstruction[] = [];
  const mint = gameAccount.mint;
  
  const accounts = [
    { pubkey: player2, isSigner: true, isWritable: true },
    { pubkey: gamePda, isSigner: false, isWritable: true },
  ];

  if (!isNativeSOL(mint)) {
    // For SPL tokens, get player2's token account and vault
    const { address: player2TokenAccount, instruction: createTokenAccountIx } = 
      await getOrCreateAssociatedTokenAccount(connection, player2, mint, player2);
    
    if (createTokenAccountIx) {
      preInstructions.push(createTokenAccountIx);
    }

    const vaultPda = deriveGamePDAs(gameAccount.creator, gameAccount.nonce, mint, programId).vaultPda!;
    
    accounts.push(
      { pubkey: player2TokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true }
    );
  } else {
    // For native SOL, add null accounts
    accounts.push(
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // placeholder
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }  // placeholder
    );
  }

  accounts.push(
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  );

  const data = Buffer.from([1]); // join_game discriminator

  const instruction = new TransactionInstruction({
    keys: accounts,
    programId,
    data,
  });

  return {
    instruction,
    preInstructions,
  };
}

/**
 * Create resolve game instruction
 */
export async function createResolveGameInstruction(
  connection: Connection,
  resolver: PublicKey,
  gamePda: PublicKey,
  winner: PublicKey,
  gameAccount: any, // Game account data
  programId: PublicKey = WAGER_PROGRAM_ID
): Promise<{
  instruction: TransactionInstruction;
  preInstructions: TransactionInstruction[];
}> {
  const preInstructions: TransactionInstruction[] = [];
  const mint = gameAccount.mint;
  
  const accounts = [
    { pubkey: resolver, isSigner: true, isWritable: true },
    { pubkey: gamePda, isSigner: false, isWritable: true },
  ];

  if (!isNativeSOL(mint)) {
    // For SPL tokens, get winner and dev wallet token accounts
    const { address: winnerTokenAccount, instruction: createWinnerTokenAccountIx } = 
      await getOrCreateAssociatedTokenAccount(connection, resolver, mint, winner);
    
    if (createWinnerTokenAccountIx) {
      preInstructions.push(createWinnerTokenAccountIx);
    }

    const { address: devTokenAccount, instruction: createDevTokenAccountIx } = 
      await getOrCreateAssociatedTokenAccount(connection, resolver, mint, gameAccount.devWallet);
    
    if (createDevTokenAccountIx) {
      preInstructions.push(createDevTokenAccountIx);
    }

    const vaultPda = deriveGamePDAs(gameAccount.creator, gameAccount.nonce, mint, programId).vaultPda!;
    
    accounts.push(
      { pubkey: winnerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: devTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true }
    );
  } else {
    // For native SOL, add winner and dev wallet accounts directly
    accounts.push(
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // placeholder for token account
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // placeholder for token account
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }  // placeholder for vault
    );
  }

  accounts.push(
    { pubkey: winner, isSigner: false, isWritable: true },
    { pubkey: gameAccount.devWallet, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  );

  const data = Buffer.concat([
    Buffer.from([2]), // resolve_game discriminator
    winner.toBuffer(),
  ]);

  const instruction = new TransactionInstruction({
    keys: accounts,
    programId,
    data,
  });

  return {
    instruction,
    preInstructions,
  };
}

/**
 * Create cancel game instruction
 */
export async function createCancelGameInstruction(
  connection: Connection,
  authority: PublicKey,
  gamePda: PublicKey,
  gameAccount: any, // Game account data
  programId: PublicKey = WAGER_PROGRAM_ID
): Promise<{
  instruction: TransactionInstruction;
  preInstructions: TransactionInstruction[];
}> {
  const preInstructions: TransactionInstruction[] = [];
  const mint = gameAccount.mint;
  
  const accounts = [
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: gamePda, isSigner: false, isWritable: true },
  ];

  if (!isNativeSOL(mint)) {
    // For SPL tokens, get creator and player2 token accounts
    const { address: creatorTokenAccount, instruction: createCreatorTokenAccountIx } = 
      await getOrCreateAssociatedTokenAccount(connection, authority, mint, gameAccount.creator);
    
    if (createCreatorTokenAccountIx) {
      preInstructions.push(createCreatorTokenAccountIx);
    }

    let player2TokenAccount = SystemProgram.programId; // placeholder
    if (gameAccount.player2 && !gameAccount.player2.equals(PublicKey.default)) {
      const { address, instruction: createPlayer2TokenAccountIx } = 
        await getOrCreateAssociatedTokenAccount(connection, authority, mint, gameAccount.player2);
      
      if (createPlayer2TokenAccountIx) {
        preInstructions.push(createPlayer2TokenAccountIx);
      }
      player2TokenAccount = address;
    }

    const vaultPda = deriveGamePDAs(gameAccount.creator, gameAccount.nonce, mint, programId).vaultPda!;
    
    accounts.push(
      { pubkey: creatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: player2TokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true }
    );
  } else {
    // For native SOL, add placeholders
    accounts.push(
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // placeholder
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // placeholder
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }  // placeholder
    );
  }

  accounts.push(
    { pubkey: gameAccount.creator, isSigner: false, isWritable: true },
    ...(gameAccount.player2 && !gameAccount.player2.equals(PublicKey.default) ? 
      [{ pubkey: gameAccount.player2, isSigner: false, isWritable: true }] : 
      [{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }]),
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
  );

  const data = Buffer.from([3]); // cancel_if_expired discriminator

  const instruction = new TransactionInstruction({
    keys: accounts,
    programId,
    data,
  });

  return {
    instruction,
    preInstructions,
  };
}

/**
 * Create update resolver instruction
 */
export async function createUpdateResolverInstruction(
  creator: PublicKey,
  gamePda: PublicKey,
  newResolver: PublicKey,
  gameAccount: any, // Game account data
  programId: PublicKey = WAGER_PROGRAM_ID
): Promise<TransactionInstruction> {
  const data = Buffer.concat([
    Buffer.from([4]), // update_resolver discriminator
    newResolver.toBuffer(),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: gamePda, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}
