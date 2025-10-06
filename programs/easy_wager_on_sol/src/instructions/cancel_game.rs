use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{state::*, error::WagerError};

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"game", game.creator.as_ref(), game.nonce.to_le_bytes().as_ref()],
        bump = game.bump
    )]
    pub game: Account<'info, Game>,

    // Creator's token account (for SPL tokens)
    #[account(
        mut,
        token::mint = game.mint,
        token::authority = game.creator
    )]
    pub creator_token_account: Option<Account<'info, TokenAccount>>,

    // Player2's token account (for SPL tokens) - if they joined
    #[account(
        mut,
        token::mint = game.mint,
        token::authority = game.player2
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

    /// CHECK: Creator account - validated against game.creator
    #[account(mut)]
    pub creator_account: UncheckedAccount<'info>,

    /// CHECK: Player2 account - validated against game.player2
    #[account(mut)]
    pub player2_account: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CancelGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let clock = Clock::get()?;

    // Validation - only creator or resolver can cancel
    require!(
        ctx.accounts.authority.key() == game.creator || 
        ctx.accounts.authority.key() == game.resolver,
        WagerError::UnauthorizedCreator
    );

    require!(ctx.accounts.creator_account.key() == game.creator, WagerError::UnauthorizedCreator);

    let mut reason = String::new();

    match game.state {
        GameState::Open => {
            // Game not full, only creator can cancel if expired
            require!(game.is_expired(&clock), WagerError::GameNotExpired);
            require!(game.player2 == Pubkey::default(), WagerError::GameFull);
            reason = "Expired without second player".to_string();

            // No refunds needed since only creator exists and hasn't deposited yet
        },
        GameState::Ready => {
            // Game is ready but expired, refund both players
            require!(game.is_expired(&clock), WagerError::GameNotExpired);
            reason = "Expired without resolution".to_string();

            if game.is_native_sol() {
                // Refund native SOL to both players
                let game_lamports = game.to_account_info().lamports();
                let refund_amount = game.wager;

                // Refund creator (player1)
                **game.to_account_info().try_borrow_mut_lamports()? = game_lamports
                    .checked_sub(refund_amount)
                    .ok_or(WagerError::MathOverflow)?;
                **ctx.accounts.creator_account.try_borrow_mut_lamports()? = ctx.accounts.creator_account
                    .to_account_info()
                    .lamports()
                    .checked_add(refund_amount)
                    .ok_or(WagerError::MathOverflow)?;

                // Refund player2
                if let Some(player2_account) = &ctx.accounts.player2_account {
                    require!(player2_account.key() == game.player2, WagerError::InvalidWinner);
                    let remaining_lamports = game.to_account_info().lamports();
                    **game.to_account_info().try_borrow_mut_lamports()? = remaining_lamports
                        .checked_sub(refund_amount)
                        .ok_or(WagerError::MathOverflow)?;
                    **player2_account.try_borrow_mut_lamports()? = player2_account
                        .to_account_info()
                        .lamports()
                        .checked_add(refund_amount)
                        .ok_or(WagerError::MathOverflow)?;
                }
            } else {
                // Refund SPL tokens to both players
                require!(ctx.accounts.creator_token_account.is_some(), WagerError::InvalidTokenAccount);
                require!(ctx.accounts.vault.is_some(), WagerError::InvalidTokenAccount);

                let creator_token_account = ctx.accounts.creator_token_account.as_ref().unwrap();
                let vault = ctx.accounts.vault.as_ref().unwrap();

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

                // Refund creator
                let creator_transfer_ctx = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: vault.to_account_info(),
                        to: creator_token_account.to_account_info(),
                        authority: game.to_account_info(),
                    },
                    signer_seeds
                );
                token::transfer(creator_transfer_ctx, game.wager)?;

                // Refund player2 if they joined
                if game.player2 != Pubkey::default() {
                    require!(ctx.accounts.player2_token_account.is_some(), WagerError::InvalidTokenAccount);
                    let player2_token_account = ctx.accounts.player2_token_account.as_ref().unwrap();
                    require!(player2_token_account.owner == game.player2, WagerError::InvalidTokenAccount);

                    let player2_transfer_ctx = CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: vault.to_account_info(),
                            to: player2_token_account.to_account_info(),
                            authority: game.to_account_info(),
                        },
                        signer_seeds
                    );
                    token::transfer(player2_transfer_ctx, game.wager)?;
                }
            }
        },
        _ => {
            return Err(WagerError::InvalidStateTransition.into());
        }
    }

    // Update game state
    game.state = GameState::Canceled;

    // Emit event
    emit!(GameCanceled {
        game: game.key(),
        reason,
    });

    Ok(())
}
