use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, error::WagerError};

#[derive(Accounts)]
#[instruction(winner: Pubkey)]
pub struct ResolveGame<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.creator.as_ref(), game.nonce.to_le_bytes().as_ref()],
        bump = game.bump
    )]
    pub game: Account<'info, Game>,

    // Winner's token account (for SPL tokens)
    #[account(
        mut,
        token::mint = game.mint,
        token::authority = winner
    )]
    pub winner_token_account: Option<Account<'info, TokenAccount>>,

    // Dev wallet's token account (for SPL tokens)
    #[account(
        mut,
        token::mint = game.mint,
        token::authority = game.dev_wallet
    )]
    pub dev_token_account: Option<Account<'info, TokenAccount>>,

    // Game's vault (for SPL tokens)
    #[account(
        mut,
        seeds = [b"vault", game.key().as_ref(), game.mint.as_ref()],
        bump = game.vault_bump,
        token::mint = game.mint,
        token::authority = game
    )]
    pub vault: Option<Account<'info, TokenAccount>>,

    /// CHECK: Winner account - validated in instruction
    #[account(mut)]
    pub winner_account: UncheckedAccount<'info>,

    /// CHECK: Dev wallet account - validated against game.dev_wallet
    #[account(mut)]
    pub dev_wallet_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ResolveGame>, winner: Pubkey) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Validation
    require!(game.can_resolve(), WagerError::GameNotReady);
    require!(ctx.accounts.resolver.key() == game.resolver, WagerError::UnauthorizedResolver);
    require!(
        winner == game.player1 || winner == game.player2,
        WagerError::InvalidWinner
    );
    require!(ctx.accounts.winner_account.key() == winner, WagerError::InvalidWinner);
    require!(ctx.accounts.dev_wallet_account.key() == game.dev_wallet, WagerError::InvalidDevWallet);

    let (winner_amount, fee_amount) = game.calculate_payouts();

    if game.is_native_sol() {
        // Handle native SOL payouts
        let game_lamports = game.to_account_info().lamports();
        
        // Transfer to winner
        **game.to_account_info().try_borrow_mut_lamports()? = game_lamports
            .checked_sub(winner_amount)
            .ok_or(WagerError::MathOverflow)?;
        **ctx.accounts.winner_account.try_borrow_mut_lamports()? = ctx.accounts.winner_account
            .to_account_info()
            .lamports()
            .checked_add(winner_amount)
            .ok_or(WagerError::MathOverflow)?;

        // Transfer to dev wallet
        let remaining_lamports = game.to_account_info().lamports();
        **game.to_account_info().try_borrow_mut_lamports()? = remaining_lamports
            .checked_sub(fee_amount)
            .ok_or(WagerError::MathOverflow)?;
        **ctx.accounts.dev_wallet_account.try_borrow_mut_lamports()? = ctx.accounts.dev_wallet_account
            .to_account_info()
            .lamports()
            .checked_add(fee_amount)
            .ok_or(WagerError::MathOverflow)?;
    } else {
        // Handle SPL token payouts
        require!(ctx.accounts.winner_token_account.is_some(), WagerError::InvalidTokenAccount);
        require!(ctx.accounts.dev_token_account.is_some(), WagerError::InvalidTokenAccount);
        require!(ctx.accounts.vault.is_some(), WagerError::InvalidTokenAccount);

        let winner_token_account = ctx.accounts.winner_token_account.as_ref().unwrap();
        let dev_token_account = ctx.accounts.dev_token_account.as_ref().unwrap();
        let vault = ctx.accounts.vault.as_ref().unwrap();

        // Verify token accounts
        require!(winner_token_account.mint == game.mint, WagerError::TokenMintMismatch);
        require!(dev_token_account.mint == game.mint, WagerError::TokenMintMismatch);

        // Create signer seeds for the game PDA
        let creator_key = game.creator;
        let nonce_bytes = game.nonce.to_le_bytes();
        let bump_bytes = [game.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"game",
            creator_key.as_ref(),
            nonce_bytes.as_ref(),
            &bump_bytes,
        ]];

        // Transfer to winner
        let winner_transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: winner_token_account.to_account_info(),
                authority: game.to_account_info(),
            },
            signer_seeds
        );
        token::transfer(winner_transfer_ctx, winner_amount)?;

        // Transfer to dev wallet
        let dev_transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: dev_token_account.to_account_info(),
                authority: game.to_account_info(),
            },
            signer_seeds
        );
        token::transfer(dev_transfer_ctx, fee_amount)?;
    }

    // Update game state
    game.state = GameState::Paid;

    // Emit event
    emit!(GameResolved {
        game: game.key(),
        winner,
        winner_amount,
        fee_amount,
    });

    Ok(())
}
