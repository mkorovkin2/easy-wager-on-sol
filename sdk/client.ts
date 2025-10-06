import {
  Connection,
  PublicKey,
  Transaction,
  Signer,
  sendAndConfirmTransaction,
  ConfirmOptions,
  AccountInfo,
  GetProgramAccountsFilter,
} from '@solana/web3.js';
import BN from 'bn.js';
import {
  GameAccount,
  GameState,
  CreateGameArgs,
  GamePDAs,
  PayoutAmounts,
  WagerClientConfig,
  WagerError,
  GameNotFoundError,
  InvalidGameStateError,
  TokenInfo,
} from './types';
import {
  WAGER_PROGRAM_ID,
  deriveGamePDAs,
  calculatePayouts,
  getTokenInfo,
  isExpired,
  formatTokenAmount,
  parseTokenAmount,
  hoursFromNow,
  generateNonce,
  retry,
} from './utils';
import {
  createCreateGameInstruction,
  createJoinGameInstruction,
  createResolveGameInstruction,
  createCancelGameInstruction,
  createUpdateResolverInstruction,
} from './instructions';

export class WagerClient {
  public readonly connection: Connection;
  public readonly programId: PublicKey;
  public readonly confirmOptions: ConfirmOptions;

  constructor(connection: Connection, config: WagerClientConfig = {}) {
    this.connection = connection;
    this.programId = config.programId || WAGER_PROGRAM_ID;
    this.confirmOptions = {
      commitment: 'confirmed',
      preflightCommitment: 'processed',
      maxRetries: 3,
      ...config.confirmOptions,
    };
  }

  /**
   * Create a new game
   */
  async createGame(
    creator: Signer,
    args: CreateGameArgs
  ): Promise<{ signature: string; gamePda: PublicKey }> {
    const { instruction, gamePda, preInstructions } = await createCreateGameInstruction(
      this.connection,
      creator.publicKey,
      args,
      this.programId
    );

    const transaction = new Transaction();
    transaction.add(...preInstructions, instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [creator],
      this.confirmOptions
    );

    return { signature, gamePda };
  }

  /**
   * Join an existing game
   */
  async joinGame(
    player2: Signer,
    gamePda: PublicKey
  ): Promise<{ signature: string }> {
    const gameAccount = await this.getGame(gamePda);
    
    if (!gameAccount.canJoin()) {
      throw new InvalidGameStateError(GameState.Open, gameAccount.state);
    }

    const { instruction, preInstructions } = await createJoinGameInstruction(
      this.connection,
      player2.publicKey,
      gamePda,
      gameAccount,
      this.programId
    );

    const transaction = new Transaction();
    transaction.add(...preInstructions, instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [player2],
      this.confirmOptions
    );

    return { signature };
  }

  /**
   * Resolve a game (declare winner)
   */
  async resolveGame(
    resolver: Signer,
    gamePda: PublicKey,
    winner: PublicKey
  ): Promise<{ signature: string; payouts: PayoutAmounts }> {
    const gameAccount = await this.getGame(gamePda);
    
    if (!gameAccount.canResolve()) {
      throw new InvalidGameStateError(GameState.Ready, gameAccount.state);
    }

    if (!winner.equals(gameAccount.player1) && !winner.equals(gameAccount.player2)) {
      throw new WagerError('Winner must be one of the two players');
    }

    const payouts = calculatePayouts(gameAccount.wager, gameAccount.payoutBps);

    const { instruction, preInstructions } = await createResolveGameInstruction(
      this.connection,
      resolver.publicKey,
      gamePda,
      winner,
      gameAccount,
      this.programId
    );

    const transaction = new Transaction();
    transaction.add(...preInstructions, instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [resolver],
      this.confirmOptions
    );

    return { signature, payouts };
  }

  /**
   * Cancel an expired game
   */
  async cancelIfExpired(
    authority: Signer,
    gamePda: PublicKey
  ): Promise<{ signature: string }> {
    const gameAccount = await this.getGame(gamePda);
    
    if (!isExpired(gameAccount.expiryTs)) {
      throw new WagerError('Game has not expired yet');
    }

    const { instruction, preInstructions } = await createCancelGameInstruction(
      this.connection,
      authority.publicKey,
      gamePda,
      gameAccount,
      this.programId
    );

    const transaction = new Transaction();
    transaction.add(...preInstructions, instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [authority],
      this.confirmOptions
    );

    return { signature };
  }

  /**
   * Update game resolver (only before deposits)
   */
  async updateResolver(
    creator: Signer,
    gamePda: PublicKey,
    newResolver: PublicKey
  ): Promise<{ signature: string }> {
    const gameAccount = await this.getGame(gamePda);
    
    if (gameAccount.state !== GameState.Open) {
      throw new WagerError('Cannot update resolver after deposits have been made');
    }

    const instruction = await createUpdateResolverInstruction(
      creator.publicKey,
      gamePda,
      newResolver,
      gameAccount,
      this.programId
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [creator],
      this.confirmOptions
    );

    return { signature };
  }

  /**
   * Get game account data
   */
  async getGame(gamePda: PublicKey): Promise<GameAccount> {
    const accountInfo = await this.connection.getAccountInfo(gamePda);
    
    if (!accountInfo || !accountInfo.data) {
      throw new GameNotFoundError(gamePda);
    }

    return this.deserializeGameAccount(accountInfo.data);
  }

  /**
   * Get multiple games by PDAs
   */
  async getGames(gamePdas: PublicKey[]): Promise<(GameAccount | null)[]> {
    const accountInfos = await this.connection.getMultipleAccountsInfo(gamePdas);
    
    return accountInfos.map((accountInfo, index) => {
      if (!accountInfo || !accountInfo.data) {
        return null;
      }
      try {
        return this.deserializeGameAccount(accountInfo.data);
      } catch (error) {
        console.warn(`Failed to deserialize game account ${gamePdas[index].toString()}:`, error);
        return null;
      }
    });
  }

  /**
   * Get all games for a creator
   */
  async getGamesByCreator(creator: PublicKey): Promise<GameAccount[]> {
    const filters: GetProgramAccountsFilter[] = [
      {
        memcmp: {
          offset: 8, // Skip discriminator
          bytes: creator.toBase58(),
        },
      },
    ];

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters,
    });

    return accounts
      .map(({ account }) => {
        try {
          return this.deserializeGameAccount(account.data);
        } catch (error) {
          console.warn('Failed to deserialize game account:', error);
          return null;
        }
      })
      .filter((game): game is GameAccount => game !== null);
  }

  /**
   * Get all games by state
   */
  async getGamesByState(state: GameState): Promise<GameAccount[]> {
    const stateOffset = 8 + 32 * 5 + 8 + 2; // After all pubkeys, wager, and payoutBps
    const filters: GetProgramAccountsFilter[] = [
      {
        memcmp: {
          offset: stateOffset,
          bytes: Buffer.from([state]).toString('base64'),
        },
      },
    ];

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters,
    });

    return accounts
      .map(({ account }) => {
        try {
          return this.deserializeGameAccount(account.data);
        } catch (error) {
          console.warn('Failed to deserialize game account:', error);
          return null;
        }
      })
      .filter((game): game is GameAccount => game !== null);
  }

  /**
   * Get open games (waiting for players)
   */
  async getOpenGames(): Promise<GameAccount[]> {
    return this.getGamesByState(GameState.Open);
  }

  /**
   * Get ready games (both players joined, waiting for resolution)
   */
  async getReadyGames(): Promise<GameAccount[]> {
    return this.getGamesByState(GameState.Ready);
  }

  /**
   * Get game PDAs for a creator and nonce
   */
  getGamePDAs(creator: PublicKey, nonce: BN, mint: PublicKey): GamePDAs {
    return deriveGamePDAs(creator, nonce, mint, this.programId);
  }

  /**
   * Calculate payouts for a game
   */
  calculatePayouts(wager: BN, payoutBps: number): PayoutAmounts {
    return calculatePayouts(wager, payoutBps);
  }

  /**
   * Get token information
   */
  async getTokenInfo(mint: PublicKey): Promise<TokenInfo> {
    return getTokenInfo(this.connection, mint);
  }

  /**
   * Format token amount for display
   */
  async formatTokenAmount(amount: BN, mint: PublicKey): Promise<string> {
    const tokenInfo = await this.getTokenInfo(mint);
    return formatTokenAmount(amount, tokenInfo.decimals);
  }

  /**
   * Parse token amount from string
   */
  async parseTokenAmount(amount: string, mint: PublicKey): Promise<BN> {
    const tokenInfo = await this.getTokenInfo(mint);
    return parseTokenAmount(amount, tokenInfo.decimals);
  }

  /**
   * Create game with convenience defaults
   */
  async createGameWithDefaults(
    creator: Signer,
    wager: BN,
    mint: PublicKey = PublicKey.default,
    options: Partial<CreateGameArgs> = {}
  ): Promise<{ signature: string; gamePda: PublicKey; gameAccount: CreateGameArgs }> {
    const args: CreateGameArgs = {
      mint,
      wager,
      payoutBps: options.payoutBps || 8500, // 85% to winner, 15% to dev
      expiryTs: options.expiryTs || hoursFromNow(24), // 24 hours from now
      devWallet: options.devWallet || creator.publicKey, // Dev wallet defaults to creator
      resolverPubkey: options.resolverPubkey || creator.publicKey, // Resolver defaults to creator
      nonce: options.nonce || generateNonce(),
    };

    const result = await this.createGame(creator, args);
    return {
      ...result,
      gameAccount: args,
    };
  }

  /**
   * Wait for game state change with timeout
   */
  async waitForGameState(
    gamePda: PublicKey,
    expectedState: GameState,
    timeoutMs: number = 30000,
    pollIntervalMs: number = 1000
  ): Promise<GameAccount> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const gameAccount = await this.getGame(gamePda);
        if (gameAccount.state === expectedState) {
          return gameAccount;
        }
      } catch (error) {
        // Game might not exist yet
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    
    throw new WagerError(`Timeout waiting for game state ${GameState[expectedState]}`);
  }

  /**
   * Deserialize game account data
   */
  private deserializeGameAccount(data: Buffer): GameAccount {
    // This is a simplified deserializer - in a real implementation,
    // you'd use the Anchor-generated deserializer or Borsh
    let offset = 8; // Skip discriminator

    const creator = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const player1 = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const player2 = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const resolver = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const devWallet = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const mint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const wager = new BN(data.slice(offset, offset + 8), 'le');
    offset += 8;
    const payoutBps = data.readUInt16LE(offset);
    offset += 2;
    const state = data.readUInt8(offset) as GameState;
    offset += 1;
    const expiryTs = new BN(data.slice(offset, offset + 8), 'le');
    offset += 8;
    const nonce = new BN(data.slice(offset, offset + 8), 'le');
    offset += 8;
    const bump = data.readUInt8(offset);
    offset += 1;
    const vaultBump = data.readUInt8(offset);

    return new GameAccountImpl({
      creator,
      player1,
      player2,
      resolver,
      devWallet,
      mint,
      wager,
      payoutBps,
      state,
      expiryTs,
      nonce,
      bump,
      vaultBump,
    });
  }
}

/**
 * Implementation of GameAccount with helper methods
 */
class GameAccountImpl implements GameAccount {
  public readonly creator!: PublicKey;
  public readonly player1!: PublicKey;
  public readonly player2!: PublicKey;
  public readonly resolver!: PublicKey;
  public readonly devWallet!: PublicKey;
  public readonly mint!: PublicKey;
  public readonly wager!: BN;
  public readonly payoutBps!: number;
  public readonly state!: GameState;
  public readonly expiryTs!: BN;
  public readonly nonce!: BN;
  public readonly bump!: number;
  public readonly vaultBump!: number;

  constructor(data: {
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
  }) {
    Object.assign(this, data);
  }

  isNativeSOL(): boolean {
    return this.mint.equals(PublicKey.default);
  }

  canJoin(): boolean {
    return this.state === GameState.Open && this.player2.equals(PublicKey.default);
  }

  canResolve(): boolean {
    return this.state === GameState.Ready;
  }

  isExpired(): boolean {
    const now = Math.floor(Date.now() / 1000);
    return this.expiryTs.toNumber() <= now;
  }
}
