# LP Guard — Live Position Planner

JavaScript 102 final project.

## Purpose

This project is a simplified educational front-end inspired by the larger LP Guard concentrated-liquidity project. It intentionally focuses on live market observation and range/composition analysis. It does not connect to wallets or execute blockchain transactions.

## Features

- Live ETH market data from the DEX Screener token-pairs API
- Network selection with a fixed USDC quote for consistent cross-network comparison
- Loading, success, no-results, and error states
- Concentrated-liquidity range analysis
- Estimated ETH/stablecoin composition
- Quick ±5%, ±10%, and ±15% range helpers
- Reset interaction
- Feedback form with JavaScript validation and confirmation
- Responsive desktop/mobile layout

## Files

- `index.html`
- `style.css`
- `script.js`
- `Documents/LP_Guard_Project_Plan.docx`

## Important

This is an educational planning tool. It does not connect a wallet, sign transactions, move assets, or provide financial advice.

## Market-pair handling

The market loader normalizes both WETH/USDC and USDC/WETH pool orientations so the displayed price always represents ETH in USDC.


## Market lookup note
The live market lookup uses known WETH and USDC contract addresses for Base, Arbitrum, and Ethereum. It queries each network's WETH and USDC token market lists-pairs endpoint, matches the canonical USDC contract by address, and selects the most liquid direct WETH/USDC market. USDC is intentionally fixed for this school project so the three networks can be compared reliably without expanding scope into every possible quote asset.
