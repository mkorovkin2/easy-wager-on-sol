use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::{state::*, error::WagerError};

#[derive(Accounts)]
#[instruction(mint: Pubkey, wager: u64, payout_bps: u16, expiry_ts: i64, resolver_pubkey: Option<Pubkey>, nonce: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Game::LEN,
        seeds = [b"game", creator.key().as_ref(), nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub game: Account<'info, Game>,

    // For SPL tokens, we need a vault token account
    #[account(
        init,
        payer = creator,
        token::mint = token_mint,
        token::authority = game,
        seeds = [b"vault", game.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub vault: Option<Account<'info, TokenAccount>>,

    // Token mint (ignored if using native SOL)
    pub token_mint: Option<Account<'info, Mint>>,

    /// CHECK: Dev wallet can be any valid pubkey
    pub dev_wallet: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateGame>,
    mint: Pubkey,
    wager: u64,
    payout_bps: u16,
    expiry_ts: i64,
    resolver_pubkey: Option<Pubkey>,
    nonce: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    
    // Validation
    require!(wager > 0, WagerError::InvalidWagerAmount);
    require!(payout_bps > 0 && payout_bps < 10000, WagerError::InvalidPayoutBps);
    require!(expiry_ts > clock.unix_timestamp, WagerError::InvalidExpiryTime);
    require!(ctx.accounts.dev_wallet.key() != Pubkey::default(), WagerError::InvalidDevWallet);

    // Check if using native SOL or SPL token
    let is_native_sol = mint == Pubkey::default();
    
    if !is_native_sol {
        // Ensure token mint and vault are provided for SPL tokens
        require!(ctx.accounts.token_mint.is_some(), WagerError::TokenMintMismatch);
        require!(ctx.accounts.vault.is_some(), WagerError::InvalidTokenAccount);
        
        let token_mint = ctx.accounts.token_mint.as_ref().unwrap();
        require!(token_mint.key() == mint, WagerError::TokenMintMismatch);
    }

    let vault_bump = if let Some(vault) = &ctx.accounts.vault {
        ctx.bumps.get("vault").copied().unwrap_or(0)
    } else {
        0
    };

    let game = &mut ctx.accounts.game;
    game.creator = ctx.accounts.creator.key();
    game.player1 = ctx.accounts.creator.key();
    game.player2 = Pubkey::default(); // Will be set when someone joins
    game.resolver = resolver_pubkey.unwrap_or(ctx.accounts.creator.key());
    game.dev_wallet = ctx.accounts.dev_wallet.key();
    game.mint = mint;
    game.wager = wager;
    game.payout_bps = payout_bps;
    game.state = GameState::Open;
    game.expiry_ts = expiry_ts;
    game.nonce = nonce;
    game.bump = ctx.bumps.game;
    game.vault_bump = vault_bump;

    // Emit event
    emit!(GameCreated {
        game: game.key(),
        creator: game.creator,
        mint: game.mint,
        wager: game.wager,
        payout_bps: game.payout_bps,
        expiry_ts: game.expiry_ts,
    });

    Ok(())
}
