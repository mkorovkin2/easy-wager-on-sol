use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, error::WagerError};

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub player2: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.creator.as_ref(), game.nonce.to_le_bytes().as_ref()],
        bump = game.bump
    )]
    pub game: Account<'info, Game>,

    // Player2's token account (for SPL tokens)
    #[account(
        mut,
        token::mint = game.mint,
        token::authority = player2
    )]
    pub player2_token_account: Option<Account<'info, TokenAccount>>,

    // Game's vault (for SPL tokens)
    #[account(
        mut,
        seeds = [b"vault", game.key().as_ref(), game.mint.as_ref()],
        bump = game.vault_bump,
        token::mint = game.mint,
        token::authority = game
    )]
    pub vault: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;

    // Validation
    require!(game.can_join(), WagerError::GameNotOpen);
    require!(!game.is_expired(&clock), WagerError::GameNotExpired);
    require!(ctx.accounts.player2.key() != game.player1, WagerError::CannotJoinOwnGame);

    if game.is_native_sol() {
        // Handle native SOL transfer
        let lamports = game.wager;
        
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.player2.to_account_info(),
                    to: ctx.accounts.game.to_account_info(),
                }
            ),
            lamports
        )?;
    } else {
        // Handle SPL token transfer
        require!(ctx.accounts.player2_token_account.is_some(), WagerError::InvalidTokenAccount);
        require!(ctx.accounts.vault.is_some(), WagerError::InvalidTokenAccount);

        let player2_token_account = ctx.accounts.player2_token_account.as_ref().unwrap();
        let vault = ctx.accounts.vault.as_ref().unwrap();

        // Verify token account mint matches game mint
        require!(player2_token_account.mint == game.mint, WagerError::TokenMintMismatch);
        require!(vault.mint == game.mint, WagerError::TokenMintMismatch);

        // Transfer tokens from player2 to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: player2_token_account.to_account_info(),
                to: vault.to_account_info(),
                authority: ctx.accounts.player2.to_account_info(),
            }
        );

        token::transfer(transfer_ctx, game.wager)?;
    }

    // Update game state
    game.player2 = ctx.accounts.player2.key();
    game.state = GameState::Ready;

    // Emit event
    emit!(GameJoined {
        game: game.key(),
        player1: game.player1,
        player2: game.player2,
    });

    Ok(())
}
