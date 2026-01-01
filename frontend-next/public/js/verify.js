let VERSION = null;

function getVersion() {
  if (!VERSION) {
    VERSION = ethers.keccak256(ethers.toUtf8Bytes('WALKIE_V5_PROVABLY_FAIR'));
  }
  return VERSION;
}

const GRID_CONFIG = {
  5: { bombs: 3 },
  6: { bombs: 5 },
  7: { bombs: 7 }
};

// Elements
let elements = {};

// Initialize function - called by verify-loader
window.initVerify = function initVerify() {
  // Ensure ethers is ready
  if (typeof ethers === 'undefined') {
    // console.log('[Verify] ethers not ready, retrying in 100ms...');
    setTimeout(initVerify, 100);
    return;
  }

  // console.log('[Verify] Initializing...');
  
  elements = {
    gameIdInput: document.getElementById('gameIdInput'),
    verifyBtn: document.getElementById('verifyBtn'),
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    resultsSection: document.getElementById('resultsSection'),
    howItWorksToggle: document.getElementById('howItWorksToggle'),
    howItWorksContent: document.getElementById('howItWorksContent')
  };

  // Check if elements exist
  if (!elements.gameIdInput || !elements.verifyBtn) {
    // console.error('[Verify] Required elements not found, retrying in 100ms...');
    setTimeout(initVerify, 100);
    return;
  }

  // Check for gameId in URL
  const urlParams = new URLSearchParams(window.location.search);
  const gameId = urlParams.get('gameId');
  if (gameId) {
    elements.gameIdInput.value = gameId;
    verifyGame(gameId);
  }

  // Event listeners
  elements.verifyBtn.addEventListener('click', () => {
    const gameId = elements.gameIdInput.value.trim();
    if (gameId) verifyGame(gameId);
  });

  elements.gameIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const gameId = elements.gameIdInput.value.trim();
      if (gameId) verifyGame(gameId);
    }
  });

  // Accordion toggle
  if (elements.howItWorksToggle) {
    elements.howItWorksToggle.addEventListener('click', () => {
      elements.howItWorksToggle.classList.toggle('open');
      elements.howItWorksContent.classList.toggle('open');
    });
  }

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.copy;
      const targetEl = document.getElementById(targetId);
      if (targetEl && targetEl.title) {
        navigator.clipboard.writeText(targetEl.title);
        btn.style.color = 'var(--safe)';
        setTimeout(() => btn.style.color = '', 1000);
      }
    });
  });

  // console.log('[Verify] Initialized');
}

async function verifyGame(gameId) {
  showLoading();
  hideError();
  hideResults();

  try {
    // Fetch game data from backend
    const response = await fetch(`${CONFIG.API_URL}/game/${gameId}`);
    const data = await response.json();

    if (!data.success || !data.game) {
      throw new Error(data.error || 'Game not found');
    }

    const game = data.game;
    // console.log('[Verify] Game data:', game);

    // Display results
    displayGameSummary(game);
    displaySeeds(game);
    displayGrid(game);
    displayDetails(game);

    showResults();
  } catch (error) {
    // console.error('[Verify] Error:', error);
    showError(error.message);
  } finally {
    hideLoading();
  }
}

function displayGameSummary(game) {
  document.getElementById('resultGameId').textContent = `#${game.game_id}`;
  
  const gridSize = game.grid_size || 5;
  document.getElementById('resultGridSize').textContent = `${gridSize}x${gridSize}`;
  document.getElementById('resultTraps').textContent = GRID_CONFIG[gridSize]?.bombs || '-';
  
  const betMON = parseFloat(ethers.formatEther(game.bet_amount || '0'));
  document.getElementById('resultBetAmount').textContent = `${betMON.toFixed(4)} MON`;
  
  const outcomeEl = document.getElementById('resultOutcome');
  if (game.phase === 'completed') {
    if (game.won) {
      outcomeEl.textContent = 'WON';
      outcomeEl.className = 'summary-value won';
    } else {
      outcomeEl.textContent = 'LOST';
      outcomeEl.className = 'summary-value lost';
    }
  } else {
    outcomeEl.textContent = game.phase.toUpperCase();
    outcomeEl.className = 'summary-value';
  }

  const payoutMON = parseFloat(ethers.formatEther(game.payout || '0'));
  const payoutEl = document.getElementById('resultPayout');
  if (game.won) {
    payoutEl.textContent = `+${payoutMON.toFixed(4)} MON`;
    payoutEl.className = 'summary-value won';
  } else {
    payoutEl.textContent = `-${betMON.toFixed(4)} MON`;
    payoutEl.className = 'summary-value lost';
  }
}

function displaySeeds(game) {
  const vrfSeedEl = document.getElementById('resultVrfSeed');
  const saltEl = document.getElementById('resultSalt');
  const finalSeedEl = document.getElementById('resultFinalSeed');
  const badgeEl = document.getElementById('verificationBadge');

  vrfSeedEl.textContent = game.vrf_seed ? truncateHash(game.vrf_seed) : 'Not received yet';
  vrfSeedEl.title = game.vrf_seed || '';
  
  saltEl.textContent = game.backend_salt ? truncateHash(game.backend_salt) : 'Not revealed yet';
  saltEl.title = game.backend_salt || '';

  // Calculate final seed if all data available
  if (game.vrf_seed && game.backend_salt) {
    const finalSeed = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'bytes32', 'uint64', 'bytes32'],
        [game.vrf_seed, game.backend_salt, game.game_id, getVersion()]
      )
    );
    finalSeedEl.textContent = truncateHash(finalSeed);
    finalSeedEl.title = finalSeed;

    // Verify salt hash
    const calculatedHash = ethers.keccak256(
      ethers.solidityPacked(['bytes32'], [game.backend_salt])
    );
    const isValid = calculatedHash.toLowerCase() === game.backend_salt_hash?.toLowerCase();

    if (isValid) {
      badgeEl.className = 'verification-badge valid';
      badgeEl.querySelector('.badge-text').textContent = 'Verified';
    } else {
      badgeEl.className = 'verification-badge invalid';
      badgeEl.querySelector('.badge-text').textContent = 'Invalid';
    }
  } else {
    finalSeedEl.textContent = 'Cannot calculate';
    badgeEl.className = 'verification-badge pending';
    badgeEl.querySelector('.badge-text').textContent = 'Pending';
  }
}

function displayGrid(game) {
  const gridEl = document.getElementById('verifyGrid');
  const gridSize = game.grid_size || 5;
  
  gridEl.style.gridTemplateColumns = `repeat(${gridSize}, 36px)`;
  gridEl.innerHTML = '';

  const revealedTiles = new Set(game.revealed_tiles || []);
  const bombPositions = new Set(game.bomb_positions || []);
  
  // Build reward maps - collected vs missed
  const collectedRewards = new Map();
  const missedRewards = new Map();
  
  // Use all_reward_tiles from API (includes both collected and missed)
  const allRewardTiles = game.all_reward_tiles || [];
  
  allRewardTiles.forEach(t => {
    if (t.isReward && t.reward && t.reward !== '0') {
      if (t.collected) {
        collectedRewards.set(t.index, t.reward);
      } else {
        missedRewards.set(t.index, t.reward);
      }
    }
  });

  // Fallback: if all_reward_tiles empty, use tile_rewards (legacy)
  if (allRewardTiles.length === 0) {
    const legacyRewards = game.tile_rewards || [];
    legacyRewards.forEach(t => {
      if (t.isReward && t.reward && t.reward !== '0') {
        const idx = t.index !== undefined ? t.index : t.tileIndex;
        if (revealedTiles.has(idx)) {
          collectedRewards.set(idx, t.reward);
        }
      }
    });
  }

  // Determine hit mine tile (last revealed tile if lost)
  let hitMineTile = null;
  if (!game.won && game.revealed_tiles && game.revealed_tiles.length > 0) {
    const lastTile = game.revealed_tiles[game.revealed_tiles.length - 1];
    if (bombPositions.has(lastTile)) {
      hitMineTile = lastTile;
    }
  }

  for (let i = 0; i < gridSize * gridSize; i++) {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    cell.title = `Tile ${i}`;

    const isRevealed = revealedTiles.has(i);
    const isBomb = bombPositions.has(i);
    const hasCollectedReward = collectedRewards.has(i);
    const hasMissedReward = missedRewards.has(i);

    // Priority: Start > Finish > Hit Trap > Collected Reward > Safe > Missed Reward > Trap > Unrevealed
    if (i === game.start_tile) {
      cell.classList.add('start');
      cell.title = 'Start';
    } else if (i === game.finish_tile) {
      cell.classList.add('finish');
      cell.title = 'Goal';
    } else if (hitMineTile === i) {
      cell.classList.add('trap-hit');
      cell.title = 'Hit Trap';
    } else if (hasCollectedReward) {
      cell.classList.add('reward-collected');
      const rewardMON = parseFloat(ethers.formatEther(collectedRewards.get(i)));
      cell.textContent = rewardMON < 1 ? rewardMON.toFixed(2) : rewardMON.toFixed(1);
      cell.title = `Collected: ${rewardMON.toFixed(4)} MON`;
    } else if (isRevealed) {
      cell.classList.add('safe');
    } else if (hasMissedReward) {
      cell.classList.add('reward-missed');
      const rewardMON = parseFloat(ethers.formatEther(missedRewards.get(i)));
      cell.textContent = rewardMON < 1 ? rewardMON.toFixed(2) : rewardMON.toFixed(1);
      cell.title = `Missed: ${rewardMON.toFixed(4)} MON`;
    } else if (isBomb) {
      cell.classList.add('trap');
      cell.title = 'Trap';
    } else {
      cell.classList.add('unrevealed');
    }

    gridEl.appendChild(cell);
  }

  // Grid status with missed rewards info
  const statusEl = document.getElementById('gridStatus');
  if (game.phase === 'completed') {
    const collectedMON = parseFloat(ethers.formatEther(game.collected_reward || '0'));
    let missedTotal = 0;
    missedRewards.forEach(r => missedTotal += parseFloat(ethers.formatEther(r)));
    
    if (game.won) {
      let statusHTML = `<span class="status-won">Goal reached!</span> Collected: <span class="status-reward">${collectedMON.toFixed(4)} MON</span>`;
      if (missedTotal > 0) {
        statusHTML += ` | Missed: <span class="status-missed">${missedTotal.toFixed(4)} MON</span>`;
      }
      statusEl.innerHTML = statusHTML;
    } else {
      let statusHTML = `<span class="status-lost">Trap hit!</span> Collected: <span class="status-reward">${collectedMON.toFixed(4)} MON</span>`;
      if (missedTotal > 0) {
        statusHTML += ` | Missed: <span class="status-missed">${missedTotal.toFixed(4)} MON</span>`;
      }
      statusEl.innerHTML = statusHTML;
    }
    statusEl.className = 'grid-status';
  } else {
    statusEl.textContent = `Game in progress (${game.phase})`;
    statusEl.className = 'grid-status';
  }
}

function displayDetails(game) {
  const playerEl = document.getElementById('resultPlayer');
  playerEl.textContent = shortenAddress(game.player);
  playerEl.href = `https://monadvision.com/address/${game.player}`;

  document.getElementById('resultSteps').textContent = game.revealed_count || 0;
  
  const collectedMON = parseFloat(ethers.formatEther(game.collected_reward || '0'));
  document.getElementById('resultCollected').textContent = `${collectedMON.toFixed(4)} MON`;
  
  document.getElementById('resultStartTile').textContent = game.start_tile ?? '-';
  document.getElementById('resultFinishTile').textContent = game.finish_tile ?? '-';
  
  const date = game.created_at ? new Date(game.created_at).toLocaleString() : '-';
  document.getElementById('resultDate').textContent = date;
}

// Utility functions
function truncateHash(hash, start = 10, end = 8) {
  if (!hash) return '';
  if (hash.length <= start + end) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

function shortenAddress(address) {
  if (!address) return '-';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function showLoading() {
  if (elements.loadingState) elements.loadingState.classList.remove('hidden');
}

function hideLoading() {
  if (elements.loadingState) elements.loadingState.classList.add('hidden');
}

function showResults() {
  if (elements.resultsSection) elements.resultsSection.classList.remove('hidden');
}

function hideResults() {
  if (elements.resultsSection) elements.resultsSection.classList.add('hidden');
}

function showError(message) {
  if (elements.errorState) {
    elements.errorState.textContent = message;
    elements.errorState.classList.remove('hidden');
  }
}

function hideError() {
  if (elements.errorState) elements.errorState.classList.add('hidden');
}
