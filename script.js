'use strict';

const TOKEN_ADDRESSES = {
  base: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  },
  arbitrum: {
    WETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
  },
  ethereum: {
    WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  }
};

class RangeDefinition {
  constructor(lower, current, upper) {
    this.lower = Number(lower);
    this.current = Number(current);
    this.upper = Number(upper);
  }

  isValid() {
    return [this.lower, this.current, this.upper].every(Number.isFinite)
      && this.lower > 0
      && this.current > 0
      && this.upper > 0
      && this.lower < this.upper;
  }

  getStatus() {
    if (this.current < this.lower) return 'Below Range';
    if (this.current > this.upper) return 'Above Range';
    return 'In Range';
  }

  getWidth() {
    return this.upper - this.lower;
  }

  getWidthPercent() {
    return (this.getWidth() / this.current) * 100;
  }
}

class CompositionCalculator {
  static calculate(range, capital) {
    const capitalValue = Number(capital);

    if (!range.isValid() || !Number.isFinite(capitalValue) || capitalValue <= 0) {
      return null;
    }

    if (range.current <= range.lower) {
      return this.buildResult(100, 0, capitalValue);
    }

    if (range.current >= range.upper) {
      return this.buildResult(0, 100, capitalValue);
    }

    const sqrtCurrent = Math.sqrt(range.current);
    const sqrtLower = Math.sqrt(range.lower);
    const sqrtUpper = Math.sqrt(range.upper);

    const ethAmountPerLiquidity = (sqrtUpper - sqrtCurrent) / (sqrtCurrent * sqrtUpper);
    const stableAmountPerLiquidity = sqrtCurrent - sqrtLower;
    const ethValuePerLiquidity = ethAmountPerLiquidity * range.current;
    const totalValuePerLiquidity = ethValuePerLiquidity + stableAmountPerLiquidity;

    const ethPercent = (ethValuePerLiquidity / totalValuePerLiquidity) * 100;
    const stablePercent = 100 - ethPercent;

    return this.buildResult(ethPercent, stablePercent, capitalValue);
  }

  static buildResult(ethPercent, stablePercent, capital) {
    return {
      ethPercent,
      stablePercent,
      ethValue: capital * (ethPercent / 100),
      stableValue: capital * (stablePercent / 100)
    };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const marketForm = document.querySelector('#market-form');
  const networkSelect = document.querySelector('#network');
  const marketResult = document.querySelector('#market-result');

  const plannerForm = document.querySelector('#planner-form');
  const currentPriceInput = document.querySelector('#current-price');
  const lowerRangeInput = document.querySelector('#lower-range');
  const upperRangeInput = document.querySelector('#upper-range');
  const capitalInput = document.querySelector('#capital');
  const analysisResult = document.querySelector('#analysis-result');
  const resetPlannerButton = document.querySelector('#reset-planner');
  const rangePresetButtons = document.querySelectorAll('.range-preset');

  const feedbackForm = document.querySelector('#feedback-form');
  const feedbackMessage = document.querySelector('#feedback-message');

  marketForm.addEventListener('submit', loadMarketData);
  networkSelect.addEventListener('change', showSelectionChanged);
  plannerForm.addEventListener('submit', analyzePosition);
  resetPlannerButton.addEventListener('click', resetPlanner);
  feedbackForm.addEventListener('submit', submitFeedback);

  rangePresetButtons.forEach((button) => {
    button.addEventListener('click', () => setRangeAroundCurrentPrice(Number(button.dataset.range)));
  });

  async function loadMarketData(event) {
    event.preventDefault();

    const network = networkSelect.value;
    const quoteSymbol = 'USDC';
    const tokenConfig = TOKEN_ADDRESSES[network];
    const wethAddress = tokenConfig?.WETH;
    const usdcAddress = tokenConfig?.USDC;

    if (!tokenConfig || !wethAddress || !usdcAddress) {
      showMarketError('This network is not configured.');
      return;
    }

    // A direct WETH/USDC pool can appear in either token's returned market list.
    // Check both lists, combine the results, and then choose the most liquid
    // exact WETH/USDC match. This avoids missing a valid pool just because it
    // was not included in one token's returned subset.
    const wethUrl = `https://api.dexscreener.com/token-pairs/v1/${network}/${wethAddress}`;
    const usdcUrl = `https://api.dexscreener.com/token-pairs/v1/${network}/${usdcAddress}`;

    showMarketLoading(network, quoteSymbol);

    try {
      const [wethResponse, usdcResponse] = await Promise.all([
        fetch(wethUrl),
        fetch(usdcUrl)
      ]);

      if (!wethResponse.ok || !usdcResponse.ok) {
        throw new Error('One or more market requests failed.');
      }

      const [wethData, usdcData] = await Promise.all([
        wethResponse.json(),
        usdcResponse.json()
      ]);

      const pairs = [
        ...(Array.isArray(wethData) ? wethData : []),
        ...(Array.isArray(usdcData) ? usdcData : [])
      ];
      const matchingMarkets = pairs
        .map((pair) => normalizeEthMarket(pair, network, quoteSymbol, tokenConfig))
        .filter(Boolean)
        .sort((a, b) => getLiquidity(b.pair) - getLiquidity(a.pair));

      if (matchingMarkets.length === 0) {
        showNoMarketResults(network, quoteSymbol);
        return;
      }

      const market = matchingMarkets[0];

      if (Number.isFinite(market.ethPrice) && market.ethPrice > 0) {
        currentPriceInput.value = market.ethPrice.toFixed(2);
        setRangeAroundCurrentPrice(10);
      }

      renderMarketResult(market, network, quoteSymbol);
    } catch (error) {
      console.error('Market data error:', error);
      showMarketError();
    }
  }

  function normalizeEthMarket(pair, network, quoteSymbol, tokenConfig) {
    if (!pair || pair.chainId !== network) return null;

    const baseAddress = pair.baseToken?.address?.toLowerCase() || '';
    const quoteAddress = pair.quoteToken?.address?.toLowerCase() || '';
    const wethAddress = tokenConfig.WETH.toLowerCase();
    const stablecoinAddress = tokenConfig[quoteSymbol].toLowerCase();

    const ethIsBase = baseAddress === wethAddress && quoteAddress === stablecoinAddress;
    const ethIsQuote = quoteAddress === wethAddress && baseAddress === stablecoinAddress;

    if (!ethIsBase && !ethIsQuote) return null;

    let ethPrice;
    let change = Number(pair.priceChange?.h24);
    let ethSymbol;

    if (ethIsBase) {
      // DEX Screener's priceUsd is the USD price of the base token, so when
      // WETH is the base token it already represents the ETH price we want.
      ethPrice = Number(pair.priceUsd);
      ethSymbol = pair.baseToken?.symbol || 'WETH';
    } else {
      // When the stablecoin is the base token, priceNative expresses one
      // stablecoin in WETH. Invert it to display WETH priced in stablecoin.
      const stablecoinInEth = Number(pair.priceNative);
      ethPrice = Number.isFinite(stablecoinInEth) && stablecoinInEth > 0
        ? 1 / stablecoinInEth
        : NaN;
      ethSymbol = pair.quoteToken?.symbol || 'WETH';

      // Price-change direction must also be inverted when the pair is reversed.
      if (Number.isFinite(change) && change > -100) {
        change = ((1 / (1 + (change / 100))) - 1) * 100;
      }
    }

    if (!Number.isFinite(ethPrice) || ethPrice <= 0) return null;

    return {
      pair,
      ethPrice,
      change,
      ethSymbol,
      stableSymbol: quoteSymbol
    };
  }

  function getLiquidity(pair) {
    return Number(pair?.liquidity?.usd) || 0;
  }

  function showSelectionChanged() {
    const network = networkSelect.value;
    const quoteSymbol = 'USDC';
    marketResult.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">↻</span>
        <h3>Selection changed</h3>
        <p>Click <strong>Load Live Data</strong> to request ${formatNetwork(network)} ETH/${escapeHtml(quoteSymbol)} market data.</p>
      </div>
    `;
  }

  function showMarketLoading(network, quoteSymbol) {
    marketResult.innerHTML = `
      <div class="loading-state">
        <span class="spinner" aria-hidden="true"></span>
        <div>
          <h3>Loading live market data…</h3>
          <p>Searching ${formatNetwork(network)} for an ETH/${escapeHtml(quoteSymbol)} market.</p>
        </div>
      </div>
    `;
  }

  function showNoMarketResults(network, quoteSymbol) {
    marketResult.innerHTML = `
      <div class="no-results-box">
        <div>
          <div class="empty-icon" aria-hidden="true">?</div>
          <h3>No matching market found</h3>
          <p>DEX Screener returned data, but no ETH/${escapeHtml(quoteSymbol)} pair matched ${formatNetwork(network)}. Try another network or try again in a moment.</p>
        </div>
      </div>
    `;
  }

  function showMarketError(message = 'LP Guard could not reach the market-data service. Check your connection and try again.') {
    marketResult.innerHTML = `
      <div class="error-box">
        <div>
          <div class="error-symbol" aria-hidden="true">!</div>
          <h3>Market data could not be loaded</h3>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    `;
  }

  function renderMarketResult(market, network, quoteSymbol) {
    const pair = market.pair;
    const price = formatCurrency(market.ethPrice, 2, 6);
    const change = market.change;
    const volume = formatCompactCurrency(pair.volume?.h24);
    const liquidity = formatCompactCurrency(pair.liquidity?.usd);
    const dexName = pair.dexId ? pair.dexId.replaceAll('-', ' ') : 'DEX market';
    const changeClass = Number.isFinite(change) && change < 0 ? 'danger' : '';
    const changeText = Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : 'N/A';
    const pairUrl = safeHttpUrl(pair.url);

    marketResult.innerHTML = `
      <div class="market-topline">
        <div>
          <h3>${escapeHtml(market.ethSymbol)} / ${escapeHtml(quoteSymbol)}</h3>
          <p>${formatNetwork(network)} · ${escapeHtml(dexName)}</p>
        </div>
        <span class="status-badge ${changeClass}">24h ${changeText}</span>
      </div>

      <div class="metric-grid">
        <div class="metric"><span>ETH Price</span><strong>${price}</strong></div>
        <div class="metric"><span>24h Volume</span><strong>${volume}</strong></div>
        <div class="metric"><span>Liquidity</span><strong>${liquidity}</strong></div>
        <div class="metric"><span>Pair Source</span><strong>${escapeHtml(dexName)}</strong></div>
      </div>
      ${pairUrl ? `<a class="market-link" href="${pairUrl}" target="_blank" rel="noopener noreferrer">View market on DEX Screener ↗</a>` : ''}
    `;
  }

  function setRangeAroundCurrentPrice(percent) {
    const currentPrice = Number(currentPriceInput.value);

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      analysisResult.innerHTML = `
        <div class="error-box">
          <div>
            <div class="error-symbol" aria-hidden="true">!</div>
            <h3>Current price needed</h3>
            <p>Load live market data or enter a valid current ETH price before using a quick range.</p>
          </div>
        </div>
      `;
      return;
    }

    const decimal = percent / 100;
    lowerRangeInput.value = (currentPrice * (1 - decimal)).toFixed(2);
    upperRangeInput.value = (currentPrice * (1 + decimal)).toFixed(2);
  }

  function analyzePosition(event) {
    event.preventDefault();

    const range = new RangeDefinition(
      lowerRangeInput.value,
      currentPriceInput.value,
      upperRangeInput.value
    );
    const capital = Number(capitalInput.value);

    if (!range.isValid()) {
      showPlannerError('Please enter a valid liquidity range. The lower boundary must be less than the upper boundary, and all prices must be positive.');
      return;
    }

    const composition = CompositionCalculator.calculate(range, capital);

    if (!composition) {
      showPlannerError('Please enter a valid positive capital amount.');
      return;
    }

    renderAnalysis(range, composition, capital);
  }

  function renderAnalysis(range, composition, capital) {
    const status = range.getStatus();
    const statusClass = status === 'In Range' ? '' : 'warning';
    const stablecoin = 'USDC';

    analysisResult.innerHTML = `
      <div class="analysis-topline">
        <div>
          <h3>Position Analysis</h3>
          <p>Projected range status and asset exposure.</p>
        </div>
        <span class="status-badge ${statusClass}">${status}</span>
      </div>

      <div class="metric-grid">
        <div class="metric"><span>Current Price</span><strong>${formatCurrency(range.current)}</strong></div>
        <div class="metric"><span>Range Width</span><strong>${formatCurrency(range.getWidth())}</strong></div>
        <div class="metric"><span>Lower Boundary</span><strong>${formatCurrency(range.lower)}</strong></div>
        <div class="metric"><span>Upper Boundary</span><strong>${formatCurrency(range.upper)}</strong></div>
        <div class="metric"><span>ETH Exposure</span><strong>${composition.ethPercent.toFixed(2)}% · ${formatCurrency(composition.ethValue)}</strong></div>
        <div class="metric"><span>${escapeHtml(stablecoin)} Exposure</span><strong>${composition.stablePercent.toFixed(2)}% · ${formatCurrency(composition.stableValue)}</strong></div>
      </div>

      <div class="allocation-wrap">
        <div class="allocation-labels">
          <span>ETH ${composition.ethPercent.toFixed(1)}%</span>
          <span>${escapeHtml(stablecoin)} ${composition.stablePercent.toFixed(1)}%</span>
        </div>
        <div class="allocation-bar" aria-label="Projected asset allocation">
          <div class="allocation-eth" style="width:${composition.ethPercent}%"></div>
          <div class="allocation-stable" style="width:${composition.stablePercent}%"></div>
        </div>
      </div>

      <p class="analysis-note">Capital modeled: ${formatCurrency(capital)} · Total range width: ${range.getWidthPercent().toFixed(2)}% of the current price. This is a planning estimate, not an execution quote.</p>
    `;
  }

  function showPlannerError(message) {
    analysisResult.innerHTML = `
      <div class="error-box">
        <div>
          <div class="error-symbol" aria-hidden="true">!</div>
          <h3>Position could not be analyzed</h3>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    `;
  }

  function resetPlanner() {
    plannerForm.reset();
    capitalInput.value = '1000';
    analysisResult.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">◎</span>
        <h3>Position analysis</h3>
        <p>Enter a current price, range, and capital amount to analyze the proposed position.</p>
      </div>
    `;
  }

  function submitFeedback(event) {
    event.preventDefault();

    const name = document.querySelector('#name').value.trim();
    const email = document.querySelector('#email').value.trim();
    const message = document.querySelector('#message').value.trim();

    if (!name || !email || !message) {
      feedbackMessage.textContent = 'Please complete all required fields before submitting.';
      return;
    }

    feedbackMessage.textContent = `Thanks, ${name}. Your feedback has been recorded for this demonstration.`;
    feedbackForm.reset();
  }

  function formatNetwork(network) {
    const names = { base: 'Base', arbitrum: 'Arbitrum', ethereum: 'Ethereum' };
    return names[network] || network;
  }

  function formatCurrency(value, minimumFractionDigits = 2, maximumFractionDigits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'N/A';

    return number.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits,
      maximumFractionDigits
    });
  }

  function formatCompactCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'N/A';

    return number.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 2
    });
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
});
