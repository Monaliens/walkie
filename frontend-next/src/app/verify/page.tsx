'use client';

import Script from 'next/script';
import Link from 'next/link';
import { useEffect } from 'react';

export default function VerifyPage() {
  // Re-initialize verify script on client-side navigation
  useEffect(() => {
    // For client-side navigation, check if initVerify exists and call it
    // The verify-loader.js handles the initial load case
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && (window as any).initVerify) {
        // Production: log removed;
        (window as any).initVerify();
      }
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <div className="verify-app">
        {/* Header */}
        <header className="verify-header">
          <div className="logo">
            <Link href="/" className="logo-link">
              <span className="logo-text">WALK<span className="accent">IE</span></span>
            </Link>
            <a href="https://monaliens.xyz" target="_blank" rel="noopener noreferrer" className="logo-subtitle">by Monaliens</a>
          </div>
          <div className="header-badge">Provably Fair</div>
        </header>

        {/* Back Button */}
        <div className="back-bar">
          <Link href="/" className="btn btn-secondary back-btn">← Back to Game</Link>
        </div>

        <main className="verify-main">
          {/* Search Section */}
          <section className="search-section">
            <h1 className="page-title">Verify Game Fairness</h1>
            <p className="page-subtitle">Enter a Game ID to verify the cryptographic proof</p>
            <div className="search-box">
              <input type="text" id="gameIdInput" className="search-input" placeholder="Enter Game ID (e.g., 123)" />
              <button className="btn btn-primary search-btn" id="verifyBtn">Verify</button>
            </div>
          </section>

          {/* Loading State */}
          <div id="loadingState" className="loading-state hidden">
            <div className="spinner"></div>
            <span>Verifying game...</span>
          </div>

          {/* Error State */}
          <div id="errorState" className="error-state hidden"></div>

          {/* Results Section */}
          <div id="resultsSection" className="results-section hidden">
            {/* Game Summary Card */}
            <div className="card game-summary-card">
              <h2 className="card-title">Game Summary</h2>
              <div className="summary-grid">
                <div className="summary-item">
                  <span className="summary-label">Game ID</span>
                  <span className="summary-value" id="resultGameId">-</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Result</span>
                  <span className="summary-value" id="resultOutcome">-</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Bet</span>
                  <span className="summary-value" id="resultBetAmount">-</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Payout</span>
                  <span className="summary-value" id="resultPayout">-</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Grid</span>
                  <span className="summary-value" id="resultGridSize">-</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Traps</span>
                  <span className="summary-value" id="resultTraps">-</span>
                </div>
              </div>
            </div>

            {/* Seeds Card */}
            <div className="card seeds-card">
              <h2 className="card-title">Seeds &amp; Commitments</h2>
              
              <div className="seed-row">
                <span className="seed-label">VRF Seed (Pyth)</span>
                <div className="seed-value-wrap">
                  <code className="seed-value" id="resultVrfSeed">-</code>
                  <button className="copy-btn" data-copy="resultVrfSeed" title="Copy">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>
              </div>

              <div className="seed-row">
                <span className="seed-label">Backend Salt</span>
                <div className="seed-value-wrap">
                  <code className="seed-value" id="resultSalt">-</code>
                  <button className="copy-btn" data-copy="resultSalt" title="Copy">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>
              </div>

              <div className="seed-row">
                <span className="seed-label">Final Seed</span>
                <div className="seed-value-wrap">
                  <code className="seed-value" id="resultFinalSeed">-</code>
                  <button className="copy-btn" data-copy="resultFinalSeed" title="Copy">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>
              </div>

              <div className="seed-row">
                <span className="seed-label">Salt Hash Verified</span>
                <div className="verification-badge" id="verificationBadge">
                  <span className="badge-icon"></span>
                  <span className="badge-text">-</span>
                </div>
              </div>
            </div>

            {/* Grid Visualization Card */}
            <div className="card grid-card">
              <h2 className="card-title">Game Map</h2>
              <div className="mini-grid-container">
                <div className="mini-grid" id="verifyGrid"></div>
              </div>
              <div className="grid-legend">
                <div className="legend-item"><span className="legend-dot safe"></span> Safe</div>
                <div className="legend-item"><span className="legend-dot reward"></span> Collected</div>
                <div className="legend-item"><span className="legend-dot trap"></span> Trap</div>
                <div className="legend-item"><span className="legend-dot start"></span> Start</div>
                <div className="legend-item"><span className="legend-dot finish"></span> Goal</div>
              </div>
              <div className="grid-status" id="gridStatus"></div>
            </div>

            {/* Game Details Card */}
            <div className="card details-card">
              <h2 className="card-title">Game Details</h2>
              <div className="details-grid">
                <div className="detail-row">
                  <span className="detail-label">Player</span>
                  <a className="detail-value link" id="resultPlayer" href="#" target="_blank" rel="noopener noreferrer">-</a>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Steps Taken</span>
                  <span className="detail-value" id="resultSteps">-</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Rewards Collected</span>
                  <span className="detail-value" id="resultCollected">-</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Start Tile</span>
                  <span className="detail-value" id="resultStartTile">-</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Goal Tile</span>
                  <span className="detail-value" id="resultFinishTile">-</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Date</span>
                  <span className="detail-value" id="resultDate">-</span>
                </div>
              </div>
            </div>
          </div>

          {/* How It Works Section (Collapsible) */}
          <section className="how-it-works-section">
            <button className="accordion-header" id="howItWorksToggle">
              <span className="accordion-title">How Provably Fair Works</span>
              <span className="accordion-icon">+</span>
            </button>
            <div className="accordion-content" id="howItWorksContent">
              
              {/* Game Flow Sequence Diagram */}
              <div className="flow-section">
                <h3 className="section-subtitle">Game Flow</h3>
                <div className="sequence-diagram">
                  {/* Actor Headers */}
                  <div className="seq-actors">
                    <div className="seq-actor player">PLAYER</div>
                    <div className="seq-actor backend">BACKEND</div>
                    <div className="seq-actor contract">CONTRACT</div>
                    <div className="seq-actor pyth">PYTH RNG</div>
                  </div>

                  {/* Vertical Lines */}
                  <div className="seq-lifelines">
                    <div className="lifeline player-line"></div>
                    <div className="lifeline backend-line"></div>
                    <div className="lifeline contract-line"></div>
                    <div className="lifeline pyth-line"></div>
                  </div>

                  {/* Steps */}
                  <div className="seq-steps">
                    {/* Step 1 */}
                    <div className="seq-step">
                      <div className="step-num player-pos"><span className="seq-num green">1</span></div>
                      <div className="step-content">
                        <div className="step-label-above">prepare game</div>
                        <div className="step-arrow-row arrow-1-2">
                          <div className="arrow-line green-line"></div>
                          <div className="arrow-head green-head right"></div>
                        </div>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="seq-step internal-step">
                      <div className="step-num backend-pos"><span className="seq-num orange">2</span></div>
                      <div className="step-internal-box">
                        <span className="step-code">saltHash = keccak256(salt)</span>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="seq-step">
                      <div className="step-num backend-pos"><span className="seq-num orange">3</span></div>
                      <div className="step-content">
                        <div className="step-label-above pos-contract">saltHash on-chain</div>
                        <div className="step-arrow-row arrow-2-3">
                          <div className="arrow-line orange-line"></div>
                          <div className="arrow-head orange-head right"></div>
                        </div>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="seq-step">
                      <div className="step-num player-pos"><span className="seq-num green">4</span></div>
                      <div className="step-content">
                        <div className="step-label-above pos-contract">startGame() + VRF fee</div>
                        <div className="step-arrow-row arrow-1-3">
                          <div className="arrow-line green-line"></div>
                          <div className="arrow-head green-head right"></div>
                        </div>
                      </div>
                    </div>

                    {/* Step 5 */}
                    <div className="seq-step">
                      <div className="step-num contract-pos"><span className="seq-num purple">5</span></div>
                      <div className="step-content">
                        <div className="step-label-above pos-pyth">request VRF</div>
                        <div className="step-arrow-row arrow-3-4">
                          <div className="arrow-line purple-line"></div>
                          <div className="arrow-head purple-head right"></div>
                        </div>
                      </div>
                    </div>

                    {/* Step 6 */}
                    <div className="seq-step">
                      <div className="step-num contract-pos"><span className="seq-num blue">6</span></div>
                      <div className="step-content">
                        <div className="step-label-above pos-pyth">vrfSeed callback</div>
                        <div className="step-arrow-row arrow-4-3 reverse">
                          <div className="arrow-head blue-head left"></div>
                          <div className="arrow-line blue-line"></div>
                        </div>
                      </div>
                    </div>

                    {/* Step 7 */}
                    <div className="seq-step">
                      <div className="step-num backend-pos"><span className="seq-num orange">7</span></div>
                      <div className="step-content">
                        <div className="step-label-above pos-contract">reveal salt + complete</div>
                        <div className="step-arrow-row arrow-2-3">
                          <div className="arrow-line orange-line"></div>
                          <div className="arrow-head orange-head right"></div>
                        </div>
                      </div>
                    </div>

                    {/* Step 8 */}
                    <div className="seq-step">
                      <div className="step-num player-pos"><span className="seq-num purple">8</span></div>
                      <div className="step-content">
                        <div className="step-label-above pos-contract">verify &amp; payout</div>
                        <div className="step-arrow-row arrow-3-1 reverse">
                          <div className="arrow-head purple-head left"></div>
                          <div className="arrow-line purple-line"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Algorithm */}
              <div className="algorithm-section">
                <h3 className="section-subtitle">Final Seed Generation</h3>
                <div className="code-block">
                  <code>
                    <span className="comment">// Dual-source randomness - neither party can manipulate</span><br />
                    finalSeed = keccak256(vrfSeed + backendSalt + gameId + VERSION)<br /><br />
                    <span className="comment">// Trap positions via Fisher-Yates shuffle</span><br />
                    for i = 0 to trapCount:<br />
                    &nbsp;&nbsp;hash = keccak256(finalSeed + gameId + &quot;mine&quot; + i + VERSION)<br />
                    &nbsp;&nbsp;j = i + (hash % (gridSize - i))<br />
                    &nbsp;&nbsp;swap(positions[i], positions[j])<br /><br />
                    traps = positions[0..trapCount-1]
                  </code>
                </div>
              </div>

              {/* Why It's Fair */}
              <div className="fair-section">
                <h3 className="section-subtitle">Why Backend Cannot Cheat</h3>
                <div className="fair-points">
                  <div className="fair-point">
                    <span className="check-icon">&#10003;</span>
                    <span><strong>Salt committed before VRF:</strong> Backend cannot change salt after seeing the random seed</span>
                  </div>
                  <div className="fair-point">
                    <span className="check-icon">&#10003;</span>
                    <span><strong>VRF is unpredictable:</strong> Backend cannot predict Pyth&apos;s random number when committing salt</span>
                  </div>
                  <div className="fair-point">
                    <span className="check-icon">&#10003;</span>
                    <span><strong>On-chain verification:</strong> Contract recalculates all trap positions and verifies every tile claim</span>
                  </div>
                  <div className="fair-point">
                    <span className="check-icon">&#10003;</span>
                    <span><strong>Wrong claims = revert:</strong> If backend lies about any tile, transaction fails and player keeps bet</span>
                  </div>
                </div>
              </div>

              {/* Contract Link */}
              <div className="contract-section">
                <h3 className="section-subtitle">Verify On-Chain</h3>
                <a href="https://monadvision.com/address/0x7f7B8135d5D4ba22d3acA7f40676Ba9D89FDe731" target="_blank" rel="noopener noreferrer" className="contract-link">
                  View Contract: 0x7f7B...e731
                </a>
              </div>
            </div>
          </section>
        </main>

        <footer className="verify-footer">
          <span className="footer-text">On Monad Mainnet · Powered by Pyth Entropy VRF</span>
        </footer>
      </div>

      {/* ethers.js is loaded in layout.tsx */}
      {/* Scripts - verify-loader handles config, verify.js in order */}
      <Script
        id="verify-loader-js"
        src="/js/verify-loader.js"
        strategy="afterInteractive"
      />
    </>
  );
}
