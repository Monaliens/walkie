let VERSION = null;

function getVersion() {
  if (!VERSION) {
    VERSION = ethers.keccak256(ethers.toUtf8Bytes('WALKIE_V5_PROVABLY_FAIR'));
  }
  return VERSION;
}

const GRID_CONFIG = {
  5: { bombs: 3, size: 25, minRewards: 5, maxRewards: 8 },
  6: { bombs: 5, size: 36, minRewards: 7, maxRewards: 10 },
  7: { bombs: 7, size: 49, minRewards: 10, maxRewards: 14 }
};

// Reward tiers (basis points: 1000 = 0.1x)
const REWARD_TIERS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
const TIER_THRESHOLDS = [3500, 6000, 8000, 9200, 9700, 9950, 10000];

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
    resultsSection: document.getElementById('resultsSection')
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

  // Manual verification button
  const calculateBtn = document.getElementById('calculateMapBtn');
  if (calculateBtn) {
    calculateBtn.addEventListener('click', onCalculateMap);
  }

  // Initialize custom dropdown
  initPixelDropdown();
}

// Custom Pixel Dropdown
function initPixelDropdown() {
  const dropdown = document.getElementById('gridSizeDropdown');
  const trigger = document.getElementById('gridSizeTrigger');
  const menu = document.getElementById('gridSizeMenu');
  const hiddenInput = document.getElementById('manualGridSize');

  if (!trigger || !menu) {
    console.log('[Dropdown] Elements not found');
    return;
  }

  console.log('[Dropdown] Initializing...');

  // Toggle dropdown on trigger click
  trigger.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = menu.classList.contains('open');
    if (isOpen) {
      trigger.classList.remove('open');
      menu.classList.remove('open');
    } else {
      trigger.classList.add('open');
      menu.classList.add('open');
    }
  };

  // Select option
  const options = menu.querySelectorAll('.pixel-dropdown-option');
  options.forEach(option => {
    option.onclick = function(e) {
      e.stopPropagation();
      const value = this.dataset.value;
      const text = this.textContent;

      // Update trigger text
      trigger.querySelector('.pixel-dropdown-value').textContent = text;

      // Update hidden input
      if (hiddenInput) hiddenInput.value = value;

      // Update selected state
      options.forEach(opt => opt.classList.remove('selected'));
      this.classList.add('selected');

      // Close dropdown
      trigger.classList.remove('open');
      menu.classList.remove('open');
    };
  });

  // Close on outside click
  document.onclick = function(e) {
    if (!dropdown.contains(e.target)) {
      trigger.classList.remove('open');
      menu.classList.remove('open');
    }
  };
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
    fillManualVerification(game);

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
  const cellSize = 36;
  const gap = 4;

  gridEl.style.gridTemplateColumns = `repeat(${gridSize}, ${cellSize}px)`;
  gridEl.innerHTML = '';

  // Remove old path SVG if exists
  const oldSvg = document.getElementById('pathSvg');
  if (oldSvg) oldSvg.remove();

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

  // Draw path lines between revealed tiles
  const revealedArray = game.revealed_tiles || [];
  if (revealedArray.length > 1) {
    const gridWidth = (cellSize + gap) * gridSize - gap;
    const gridHeight = gridWidth;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'pathSvg';
    svg.setAttribute('width', gridWidth);
    svg.setAttribute('height', gridHeight);
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';

    // Calculate center position of a tile
    const getTileCenter = (tileIndex) => {
      const col = tileIndex % gridSize;
      const row = Math.floor(tileIndex / gridSize);
      const x = col * (cellSize + gap) + cellSize / 2;
      const y = row * (cellSize + gap) + cellSize / 2;
      return { x, y };
    };

    // Draw lines between consecutive tiles (edge to edge, not center to center)
    const edgeOffset = cellSize / 2 - 2; // Start/end near edge of cell

    for (let i = 0; i < revealedArray.length - 1; i++) {
      const from = getTileCenter(revealedArray[i]);
      const to = getTileCenter(revealedArray[i + 1]);

      // Calculate direction vector
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;

      // Start from edge of first cell, end at edge of second cell
      const startX = from.x + nx * edgeOffset;
      const startY = from.y + ny * edgeOffset;
      const endX = to.x - nx * edgeOffset;
      const endY = to.y - ny * edgeOffset;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', startX);
      line.setAttribute('y1', startY);
      line.setAttribute('x2', endX);
      line.setAttribute('y2', endY);
      line.setAttribute('stroke', '#ff9500');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', '0.8');
      svg.appendChild(line);
    }

    // Add SVG to grid container
    gridEl.style.position = 'relative';
    gridEl.appendChild(svg);
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
  playerEl.href = `https://testnet.monadexplorer.com/address/${game.player}`;

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

// Manual Verification Functions
function getAdjacent4Way(tile, gridWidth) {
  const x = tile % gridWidth;
  const y = Math.floor(tile / gridWidth);
  const adjacent = [];
  if (y > 0) adjacent.push(tile - gridWidth);
  if (y < gridWidth - 1) adjacent.push(tile + gridWidth);
  if (x > 0) adjacent.push(tile - 1);
  if (x < gridWidth - 1) adjacent.push(tile + 1);
  return adjacent;
}

function hasPath(start, finish, bombSet, gridWidth) {
  if (bombSet.has(start) || bombSet.has(finish)) return false;
  const visited = new Set();
  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === finish) return true;
    for (const neighbor of getAdjacent4Way(current, gridWidth)) {
      if (!visited.has(neighbor) && !bombSet.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return false;
}

/**
 * Get reward count for this game
 */
function getRewardCount(finalSeed, gameId, gridWidth) {
  const config = GRID_CONFIG[gridWidth] || GRID_CONFIG[5];
  const hash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'bytes32'], [finalSeed, BigInt(gameId), 'rewardCount', getVersion()])
  );
  const range = config.maxRewards - config.minRewards;
  return config.minRewards + Number(BigInt(hash) % BigInt(range + 1));
}

/**
 * Calculate reward tile positions
 */
function getRewardPositions(finalSeed, gameId, bombSet, startTile, finishTile, gridWidth) {
  const config = GRID_CONFIG[gridWidth] || GRID_CONFIG[5];
  const rewardCount = getRewardCount(finalSeed, gameId, gridWidth);

  // Build array of available tiles for rewards
  const available = [];
  for (let i = 0; i < config.size; i++) {
    if (i !== startTile && i !== finishTile && !bombSet.has(i)) {
      available.push(i);
    }
  }

  // Fisher-Yates to select reward positions
  const actualRewardCount = Math.min(rewardCount, available.length);
  for (let i = 0; i < actualRewardCount; i++) {
    const hash = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint64', 'string', 'uint8', 'bytes32'], [finalSeed, BigInt(gameId), 'rewardPos', i, getVersion()])
    );
    const j = i + Number(BigInt(hash) % BigInt(available.length - i));
    [available[i], available[j]] = [available[j], available[i]];
  }

  return available.slice(0, actualRewardCount);
}

/**
 * Get reward tier multiplier string for a tile
 */
function getTileRewardTier(finalSeed, gameId, tileIndex) {
  const hash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'uint8', 'bytes32'], [finalSeed, BigInt(gameId), 'reward', tileIndex, getVersion()])
  );
  const roll = Number(BigInt(hash) % 10000n);

  // Return multiplier string based on tier
  const multipliers = ['0.1x', '0.2x', '0.5x', '1x', '2x', '5x', '10x'];
  for (let i = 0; i < 7; i++) {
    if (roll < TIER_THRESHOLDS[i]) {
      return multipliers[i];
    }
  }
  return multipliers[6];
}

function calculateMapFromSeeds(vrfSeed, backendSalt, gameId, gridWidth) {
  const config = GRID_CONFIG[gridWidth] || GRID_CONFIG[5];
  const totalTiles = config.size;
  const bombCount = config.bombs;

  // Calculate final seed
  const finalSeed = ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'bytes32', 'uint64', 'bytes32'],
      [vrfSeed, backendSalt, BigInt(gameId), getVersion()]
    )
  );

  // Calculate start tile (bottom row)
  const bottomRowStart = totalTiles - gridWidth;
  const startHash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'bytes32'], [finalSeed, BigInt(gameId), 'start', getVersion()])
  );
  const startTile = bottomRowStart + Number(BigInt(startHash) % BigInt(gridWidth));

  // Calculate finish tile (top row)
  const finishHash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'bytes32'], [finalSeed, BigInt(gameId), 'finish', getVersion()])
  );
  const finishTile = Number(BigInt(finishHash) % BigInt(gridWidth));

  // Calculate bomb positions with nonce
  let bombSet = new Set();
  let usedNonce = 0;

  for (let nonce = 0; nonce < 100; nonce++) {
    const bombs = new Set();
    const available = [];

    for (let i = 0; i < totalTiles; i++) {
      if (i !== startTile && i !== finishTile) available.push(i);
    }

    for (let i = 0; i < bombCount; i++) {
      const hash = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'uint64', 'string', 'uint8', 'uint8', 'bytes32'],
          [finalSeed, BigInt(gameId), 'bomb', nonce, i, getVersion()]
        )
      );
      const j = i + Number(BigInt(hash) % BigInt(available.length - i));
      [available[i], available[j]] = [available[j], available[i]];
      bombs.add(available[i]);
    }

    if (hasPath(startTile, finishTile, bombs, gridWidth)) {
      bombSet = bombs;
      usedNonce = nonce;
      break;
    }
  }

  // Calculate reward positions
  const rewardPositions = getRewardPositions(finalSeed, gameId, bombSet, startTile, finishTile, gridWidth);

  // Get reward tier for each reward position
  const rewardTiles = rewardPositions.map(pos => ({
    position: pos,
    tier: getTileRewardTier(finalSeed, gameId, pos)
  })).sort((a, b) => a.position - b.position);

  return {
    finalSeed,
    startTile,
    finishTile,
    bombPositions: Array.from(bombSet).sort((a, b) => a - b),
    nonce: usedNonce,
    rewardTiles
  };
}

function displayManualGrid(gridWidth, startTile, finishTile, bombPositions, rewardTiles) {
  const gridEl = document.getElementById('manualGrid');
  if (!gridEl) return;

  const totalTiles = gridWidth * gridWidth;
  const bombSet = new Set(bombPositions);

  // Build reward map: position -> tier
  const rewardMap = new Map();
  if (rewardTiles) {
    rewardTiles.forEach(r => rewardMap.set(r.position, r.tier));
  }

  gridEl.style.gridTemplateColumns = `repeat(${gridWidth}, 36px)`;
  gridEl.innerHTML = '';

  for (let i = 0; i < totalTiles; i++) {
    const cell = document.createElement('div');
    cell.className = 'mini-cell';
    cell.title = `Tile ${i}`;

    if (i === startTile) {
      cell.classList.add('start');
      cell.title = 'Start';
    } else if (i === finishTile) {
      cell.classList.add('finish');
      cell.title = 'Goal';
    } else if (bombSet.has(i)) {
      cell.classList.add('trap');
      cell.title = 'Trap';
    } else if (rewardMap.has(i)) {
      cell.classList.add('reward-missed');
      cell.textContent = rewardMap.get(i);
      cell.title = `Reward: ${rewardMap.get(i)}`;
    } else {
      cell.classList.add('safe');
    }

    gridEl.appendChild(cell);
  }
}

function onCalculateMap() {
  const vrfSeed = document.getElementById('manualVrfSeed').value.trim();
  const backendSalt = document.getElementById('manualBackendSalt').value.trim();
  const gameId = document.getElementById('manualGameId').value.trim();
  const gridWidth = parseInt(document.getElementById('manualGridSize').value);

  if (!vrfSeed || !backendSalt || !gameId) {
    alert('Please fill in all fields');
    return;
  }

  if (!vrfSeed.startsWith('0x') || vrfSeed.length !== 66) {
    alert('VRF Seed must be a valid 32-byte hex (0x + 64 chars)');
    return;
  }

  if (!backendSalt.startsWith('0x') || backendSalt.length !== 66) {
    alert('Backend Salt must be a valid 32-byte hex (0x + 64 chars)');
    return;
  }

  try {
    const result = calculateMapFromSeeds(vrfSeed, backendSalt, gameId, gridWidth);

    document.getElementById('manualFinalSeed').textContent = truncateHash(result.finalSeed);
    document.getElementById('manualFinalSeed').title = result.finalSeed;
    document.getElementById('manualStartTile').textContent = result.startTile;
    document.getElementById('manualFinishTile').textContent = result.finishTile;
    document.getElementById('manualNonce').textContent = result.nonce;
    document.getElementById('manualBombs').textContent = `[${result.bombPositions.join(', ')}]`;

    // Display reward positions with tiers as array
    const rewardText = result.rewardTiles.map(r => `${r.position}(${r.tier})`).join(', ');
    document.getElementById('manualRewards').textContent = `[${rewardText}]` || 'None';

    displayManualGrid(gridWidth, result.startTile, result.finishTile, result.bombPositions, result.rewardTiles);

    document.getElementById('manualResults').classList.remove('hidden');
  } catch (err) {
    alert('Error calculating map: ' + err.message);
  }
}

function fillManualVerification(game) {
  if (!game) return;

  const vrfInput = document.getElementById('manualVrfSeed');
  const saltInput = document.getElementById('manualBackendSalt');
  const gameIdInput = document.getElementById('manualGameId');
  const gridSizeInput = document.getElementById('manualGridSize');

  if (vrfInput && game.vrf_seed) vrfInput.value = game.vrf_seed;
  if (saltInput && game.backend_salt) saltInput.value = game.backend_salt;
  if (gameIdInput && game.game_id) gameIdInput.value = game.game_id;
  if (gridSizeInput && game.grid_size) gridSizeInput.value = game.grid_size.toString();
}
