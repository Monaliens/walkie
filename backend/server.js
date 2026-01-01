// Load .env from current directory or parent directory
const path = require('path');
const fs = require('fs');
const localEnv = path.join(__dirname, '.env');
const parentEnv = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : parentEnv });

const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { ethers } = require('ethers');
const { createWalletClient, http, defineChain, encodeFunctionData, parseGwei } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const db = require('./db');
const EventListener = require('./eventListener');

const app = express();

// CORS configuration for production
const corsOptions = {
  origin: [
    'https://walkie.monaliens.xyz',
    'http://walkie.monaliens.xyz',
    'http://localhost:4321',
    'http://localhost:3000',
    'http://127.0.0.1:4321'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Session-Token', 'Authorization']
};
app.use(cors(corsOptions));
app.use(express.json());

const PORT = process.env.PORT || 4322;
const PRIORITY_FEE_VIEM = parseGwei('10');

// Monad Testnet chain definition
const monad = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || 'https://rpc.monad.xyz'] }
  }
});

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const VERSION = ethers.keccak256(ethers.toUtf8Bytes('WALKIE_V5_PROVABLY_FAIR'));

const TileType = {
  EMPTY: 0,
  BOMB: 1,
  REWARD: 2
};

// Grid configurations
const GRID_CONFIG = {
  5: { size: 25, bombs: 3, minRewards: 5, maxRewards: 8 },
  6: { size: 36, bombs: 5, minRewards: 7, maxRewards: 10 },
  7: { size: 49, bombs: 7, minRewards: 10, maxRewards: 14 }
};

// Reward tiers (basis points: 1000 = 0.1x)
const REWARD_TIERS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
const TIER_THRESHOLDS = [3500, 6000, 8000, 9200, 9700, 9950, 10000];

// ═══════════════════════════════════════════════════════════════
// GRID HELPERS
// ═══════════════════════════════════════════════════════════════

function getGridConfig(gridWidth) {
  return GRID_CONFIG[gridWidth] || GRID_CONFIG[5];
}

function getStartTiles(gridWidth) {
  const totalTiles = gridWidth * gridWidth;
  const tiles = [];
  for (let i = totalTiles - gridWidth; i < totalTiles; i++) {
    tiles.push(i);
  }
  return tiles;
}

function getFinishTiles(gridWidth) {
  const tiles = [];
  for (let i = 0; i < gridWidth; i++) {
    tiles.push(i);
  }
  return tiles;
}

// ═══════════════════════════════════════════════════════════════
// VIEM ABI
// ═══════════════════════════════════════════════════════════════

const VIEM_ABI = [
  {
    name: 'commitSaltHash',
    type: 'function',
    inputs: [
      { name: 'player', type: 'address' },
      { name: 'saltHash', type: 'bytes32' }
    ],
    outputs: []
  },
  {
    name: 'setGameTiles',
    type: 'function',
    inputs: [
      { name: 'gameId', type: 'uint64' },
      { name: '_startTile', type: 'uint8' },
      { name: '_finishTile', type: 'uint8' }
    ],
    outputs: []
  },
  {
    name: 'revealTile',
    type: 'function',
    inputs: [
      { name: 'player', type: 'address' },
      { name: 'gameId', type: 'uint64' },
      { name: 'tileIndex', type: 'uint8' },
      { name: 'tileType', type: 'uint8' },
      { name: 'reward', type: 'uint256' }
    ],
    outputs: []
  },
  {
    name: 'completeGame',
    type: 'function',
    inputs: [
      { name: 'gameId', type: 'uint64' },
      { name: 'backendSalt', type: 'bytes32' },
      { name: 'nonce', type: 'uint8' }
    ],
    outputs: []
  }
];

let viemWalletClient = null;

// ═══════════════════════════════════════════════════════════════
// PATH FINDING - BFS (Dynamic Grid)
// ═══════════════════════════════════════════════════════════════

function getAdjacent4Way(tile, gridWidth) {
  const x = tile % gridWidth;
  const y = Math.floor(tile / gridWidth);
  const adjacent = [];

  if (y > 0) adjacent.push(tile - gridWidth);  // up
  if (y < gridWidth - 1) adjacent.push(tile + gridWidth);  // down
  if (x > 0) adjacent.push(tile - 1);  // left
  if (x < gridWidth - 1) adjacent.push(tile + 1);  // right

  return adjacent;
}

function isAdjacent4Way(from, to, gridWidth) {
  return getAdjacent4Way(from, gridWidth).includes(to);
}

/**
 * BFS to check if path exists from start to finish avoiding bombs
 */
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

// ═══════════════════════════════════════════════════════════════
// GAME SETUP CALCULATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Select start and finish tiles deterministically from seed
 */
function selectStartAndFinish(finalSeed, gameId, gridWidth) {
  const startTiles = getStartTiles(gridWidth);
  const finishTiles = getFinishTiles(gridWidth);

  const startHash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'bytes32'], [finalSeed, BigInt(gameId), 'start', VERSION])
  );
  const finishHash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'bytes32'], [finalSeed, BigInt(gameId), 'finish', VERSION])
  );

  const startTile = startTiles[Number(BigInt(startHash) % BigInt(startTiles.length))];
  const finishTile = finishTiles[Number(BigInt(finishHash) % BigInt(finishTiles.length))];

  return { startTile, finishTile };
}

/**
 * Place bombs with guaranteed path from start to finish
 * Returns { bombSet, nonce } - nonce is the attempt that succeeded
 */
function placeBombsWithNonce(finalSeed, gameId, startTile, finishTile, gridWidth) {
  const config = getGridConfig(gridWidth);
  const totalTiles = config.size;
  const bombCount = config.bombs;
  const maxAttempts = 100;

  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const bombs = new Set();
    const available = [];

    // All tiles except start and finish
    for (let i = 0; i < totalTiles; i++) {
      if (i !== startTile && i !== finishTile) available.push(i);
    }

    // Fisher-Yates shuffle to select bombs
    for (let i = 0; i < bombCount; i++) {
      const hash = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'uint64', 'string', 'uint8', 'uint8', 'bytes32'],
          [finalSeed, BigInt(gameId), 'bomb', nonce, i, VERSION]
        )
      );
      const j = i + Number(BigInt(hash) % BigInt(available.length - i));

      // Swap
      [available[i], available[j]] = [available[j], available[i]];
      bombs.add(available[i]);
    }

    // Check if path exists
    if (hasPath(startTile, finishTile, bombs, gridWidth)) {
      return { bombSet: bombs, nonce };
    }
  }

  // Fallback (should never happen)
  console.error('[PlaceBombs] Could not find valid map after 100 attempts');
  return { bombSet: new Set([5, 9, 15]), nonce: 0 };
}

/**
 * Convert bomb set to bitmap (BigInt for uint64)
 */
function bombSetToBitmap(bombSet) {
  let bitmap = 0n;
  for (const pos of bombSet) {
    bitmap |= (1n << BigInt(pos));
  }
  return bitmap;
}

/**
 * Get reward count for this game
 */
function getRewardCount(finalSeed, gameId, gridWidth) {
  const config = getGridConfig(gridWidth);
  const hash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'bytes32'], [finalSeed, BigInt(gameId), 'rewardCount', VERSION])
  );
  const range = config.maxRewards - config.minRewards;
  return config.minRewards + Number(BigInt(hash) % BigInt(range + 1));
}

/**
 * Check if tile is a reward tile
 */
function isRewardTile(finalSeed, gameId, bombSet, startTile, finishTile, tileIndex, gridWidth) {
  // Start, finish, and bombs can't have rewards
  if (tileIndex === startTile || tileIndex === finishTile || bombSet.has(tileIndex)) {
    return false;
  }

  const config = getGridConfig(gridWidth);
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
      ethers.solidityPacked(['bytes32', 'uint64', 'string', 'uint8', 'bytes32'], [finalSeed, BigInt(gameId), 'rewardPos', i, VERSION])
    );
    const j = i + Number(BigInt(hash) % BigInt(available.length - i));
    [available[i], available[j]] = [available[j], available[i]];
  }

  // Check if tile is in first rewardCount positions
  for (let i = 0; i < actualRewardCount; i++) {
    if (available[i] === tileIndex) return true;
  }

  return false;
}

/**
 * Get tile reward amount
 */
function getTileReward(finalSeed, gameId, betAmount, tileIndex) {
  const hash = ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'uint64', 'string', 'uint8', 'bytes32'], [finalSeed, BigInt(gameId), 'reward', tileIndex, VERSION])
  );
  const roll = Number(BigInt(hash) % 10000n);

  for (let i = 0; i < 7; i++) {
    if (roll < TIER_THRESHOLDS[i]) {
      return (BigInt(betAmount) * BigInt(REWARD_TIERS[i])) / 10000n;
    }
  }
  return (BigInt(betAmount) * BigInt(REWARD_TIERS[6])) / 10000n;
}

/**
 * Calculate final seed
 */
function calculateFinalSeed(pythSeed, backendSalt, gameId) {
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'bytes32', 'uint64', 'bytes32'], [pythSeed, backendSalt, BigInt(gameId), VERSION])
  );
}

/**
 * Calculate missed rewards (unrevealed reward tiles)
 */
function calculateMissedRewards(finalSeed, gameId, bombSet, startTile, finishTile, betAmount, revealedTiles, gridWidth) {
  const config = getGridConfig(gridWidth);
  const missed = [];

  for (let i = 0; i < config.size; i++) {
    // Skip already revealed tiles
    if (revealedTiles.has(i)) continue;

    // Check if this is a reward tile
    if (isRewardTile(finalSeed, gameId, bombSet, startTile, finishTile, i, gridWidth)) {
      const reward = getTileReward(finalSeed, gameId, betAmount, i);
      missed.push({
        index: i,
        reward: reward.toString()
      });
    }
  }

  return missed;
}

// ═══════════════════════════════════════════════════════════════
// NONCE MANAGER
// ═══════════════════════════════════════════════════════════════

class NonceManager {
  constructor(wallet, provider) {
    this.wallet = wallet;
    this.provider = provider;
    this.currentNonce = null;
    this.pendingCount = 0;
    this.lock = Promise.resolve();
  }

  async initialize() {
    this.currentNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
    console.log(`[NonceManager] Initialized with nonce: ${this.currentNonce}`);
  }

  async getNextNonce() {
    let release;
    const acquireLock = new Promise(resolve => { release = resolve; });
    const previousLock = this.lock;
    this.lock = acquireLock;
    await previousLock;

    try {
      if (this.currentNonce === null) await this.initialize();
      const nonce = this.currentNonce++;
      this.pendingCount++;
      return nonce;
    } finally {
      release();
    }
  }

  onTxComplete() {
    this.pendingCount--;
  }

  async resync() {
    this.currentNonce = await this.provider.getTransactionCount(this.wallet.address, 'pending');
  }
}

let nonceManager = null;

// ═══════════════════════════════════════════════════════════════
// SYNC TX
// ═══════════════════════════════════════════════════════════════

async function sendSyncTx(functionName, args, gasLimit = 3000000, retries = 2) {
  if (!viemWalletClient) throw new Error('Viem wallet client not initialized');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const nonce = await nonceManager.getNextNonce();

    try {
      const data = encodeFunctionData({ abi: VIEM_ABI, functionName, args });

      const receipt = await viemWalletClient.sendTransactionSync({
        to: process.env.BOMBOMB_CONTRACT_ADDRESS,
        data,
        gas: BigInt(gasLimit),
        maxPriorityFeePerGas: PRIORITY_FEE_VIEM,
        nonce
      });

      nonceManager.onTxComplete();
      console.log(`[SyncTx] ${functionName}: ${receipt.transactionHash} (status: ${receipt.status})`);

      return {
        hash: receipt.transactionHash,
        receipt,
        status: receipt.status === 'success' ? 1 : 0
      };

    } catch (err) {
      nonceManager.onTxComplete();
      const errMsg = (err.message?.toLowerCase() || '') + (err.shortMessage?.toLowerCase() || '');
      const isNonceError = errMsg.includes('nonce') || errMsg.includes('replacement');

      if (isNonceError && attempt < retries) {
        await nonceManager.resync();
        continue;
      }
      throw err;
    }
  }
}

const BOMBOMB_ABI = [
  "function commitSaltHash(address player, bytes32 saltHash) external",
  "function startGame(uint8 _gridSize) external payable",
  "function setGameTiles(uint64 gameId, uint8 _startTile, uint8 _finishTile) external",
  "function revealTile(address player, uint64 gameId, uint8 tileIndex, uint8 tileType, uint256 reward) external",
  "function completeGame(uint64 gameId, bytes32 backendSalt, uint8 nonce) external",
  "function getEntropyFee() external view returns (uint128)",
  "function getGame(uint64 gameId) external view returns (tuple(address player, uint256 betAmount, uint8 revealedCount, uint256 collectedReward, bytes32 vrfCommitment, bytes32 pythSeed, bytes32 backendSaltHash, uint8 phase, bool won, uint256 payout, uint256 timestamp))",
  "function getActiveGame(address player) external view returns (uint64)",
  "function getGameTiles(uint64 gameId) external view returns (uint8, uint8, uint8, uint8, uint256)",
  "function contractBalance() external view returns (uint256)",
  "function getBombCountForGrid(uint8 gridWidth) external pure returns (uint8)",
  "function getPendingSaltHash(address player) external view returns (bytes32)"
];

let provider, wallet, contract, eventListener;

// WebSocket clients
const wsClients = new Map();
const gameSubscribers = new Map();

function broadcast(message, gameId = null) {
  const data = JSON.stringify(message);
  if (gameId) {
    const subscribers = gameSubscribers.get(gameId);
    if (subscribers) {
      subscribers.forEach(ws => { if (ws.readyState === 1) ws.send(data); });
    }
  } else {
    wsClients.forEach((_, ws) => { if (ws.readyState === 1) ws.send(data); });
  }
}

function broadcastToGame(gameId, message) {
  broadcast(message, gameId.toString());
}

// ═══════════════════════════════════════════════════════════════
// SESSION SYSTEM
// ═══════════════════════════════════════════════════════════════

const playerSessions = new Map();
const tokenToPlayer = new Map();
const SESSION_DURATION = 60 * 60 * 1000;

// Pending salts cache (in memory, also saved to DB)
const pendingSaltCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [player, session] of playerSessions) {
    if (session.expiresAt < now) {
      tokenToPlayer.delete(session.token);
      playerSessions.delete(player);
    }
  }
}, 60000);

function validateSession(token) {
  if (!token) return null;
  const player = tokenToPlayer.get(token);
  if (!player) return null;
  const session = playerSessions.get(player);
  if (!session || session.expiresAt < Date.now()) {
    tokenToPlayer.delete(token);
    if (session) playerSessions.delete(player);
    return null;
  }
  return player;
}

// ═══════════════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: 'v5', game: 'walkie-provably-fair', grids: [5, 6, 7] });
});

// Session
app.post('/api/session', async (req, res) => {
  try {
    const { signature, timestamp, player } = req.body;
    if (!signature || !timestamp || !player) {
      return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 60) {
      return res.status(400).json({ success: false, error: 'Signature expired' });
    }

    const message = JSON.stringify({
      type: 'bombomb-session',
      player: player.toLowerCase(),
      timestamp,
      chainId: 10143
    });

    let recoveredAddress;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid signature' });
    }

    if (recoveredAddress.toLowerCase() !== player.toLowerCase()) {
      return res.status(403).json({ success: false, error: 'Signature mismatch' });
    }

    const existing = playerSessions.get(player.toLowerCase());
    if (existing && existing.expiresAt > Date.now()) {
      existing.expiresAt = Date.now() + SESSION_DURATION;
      return res.json({ success: true, token: existing.token, expiresAt: existing.expiresAt });
    }

    const token = ethers.hexlify(ethers.randomBytes(32));
    const expiresAt = Date.now() + SESSION_DURATION;

    if (existing) tokenToPlayer.delete(existing.token);
    playerSessions.set(player.toLowerCase(), { token, expiresAt });
    tokenToPlayer.set(token, player.toLowerCase());

    res.json({ success: true, token, expiresAt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/session', (req, res) => {
  const token = req.headers['x-session-token'];
  const player = validateSession(token);
  if (!player) return res.json({ success: true, valid: false });
  const session = playerSessions.get(player);
  res.json({ success: true, valid: true, player, expiresAt: session.expiresAt });
});

// Get active game
app.get('/api/game/active/:address', async (req, res) => {
  try {
    const game = await db.getActiveGame(req.params.address);
    if (game) {
      const actions = await db.getGameActions(game.game_id);
      const tileData = actions
        .filter(a => a.tile_index !== undefined)
        .map(a => ({
          tileIndex: a.tile_index,
          tileType: a.tile_type,
          isReward: a.is_reward,
          isEmpty: a.is_empty,
          isBomb: a.is_bomb,
          reward: a.reward || '0'
        }));

      const gameObj = game.toObject ? game.toObject() : { ...game };
      gameObj.tile_data = tileData;

      
      if (gameObj.phase !== 'completed') {
        gameObj.vrf_seed = null;
        gameObj.backend_salt = null;
      }

      res.json({ success: true, game: gameObj });
    } else {
      res.json({ success: true, game: null });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get game
app.get('/api/game/:gameId', async (req, res) => {
  try {
    const game = await db.getGame(req.params.gameId);
    if (!game) return res.status(404).json({ success: false, error: 'Not found' });

    // For completed games, calculate all reward tiles (collected + missed)
    let allRewardTiles = [];
    if (game.phase === 'completed' && game.vrf_seed && game.backend_salt) {
      try {
        const finalSeed = calculateFinalSeed(game.vrf_seed, game.backend_salt, game.game_id);
        const gridWidth = game.grid_size || 5;
        const config = getGridConfig(gridWidth);
        const bombSet = new Set(game.bomb_positions || []);
        const revealedSet = new Set(game.revealed_tiles || []);

        // Calculate all reward tile positions
        for (let i = 0; i < config.size; i++) {
          if (isRewardTile(finalSeed, game.game_id, bombSet, game.start_tile, game.finish_tile, i, gridWidth)) {
            const reward = getTileReward(finalSeed, game.game_id, game.bet_amount, i);
            allRewardTiles.push({
              index: i,
              isBomb: false,
              isReward: true,
              reward: reward.toString(),
              collected: revealedSet.has(i)
            });
          }
        }
      } catch (err) {
        console.error('Error calculating reward tiles:', err.message);
      }
    }

    const gameObj = game.toObject();
    if (allRewardTiles.length > 0) {
      gameObj.all_reward_tiles = allRewardTiles;
    }

    res.json({ success: true, game: gameObj });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get game actions (for verification)
app.get('/api/game/:gameId/actions', async (req, res) => {
  try {
    const actions = await db.getGameActions(req.params.gameId);
    res.json({ success: true, actions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get entropy fee
app.get('/api/entropy-fee', async (req, res) => {
  try {
    const fee = await contract.getEntropyFee();
    res.json({ success: true, fee: fee.toString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PREPARE GAME
// ═══════════════════════════════════════════════════════════════
app.post('/api/game/prepare', async (req, res) => {
  try {
    const token = req.headers['x-session-token'];
    const player = validateSession(token);
    if (!player) return res.status(401).json({ success: false, error: 'Invalid session' });

    // Get grid size from request (default to 5)
    const gridWidth = parseInt(req.body.gridSize) || 5;
    if (![5, 6, 7].includes(gridWidth)) {
      return res.status(400).json({ success: false, error: 'Grid size must be 5, 6, or 7' });
    }

    const existingGame = await db.getActiveGame(player);
    if (existingGame) {
      return res.status(400).json({ success: false, error: 'Active game exists', gameId: existingGame.game_id });
    }

    // Generate backend salt
    const backendSalt = ethers.hexlify(ethers.randomBytes(32));
    const backendSaltHash = ethers.keccak256(ethers.solidityPacked(['bytes32'], [backendSalt]));

    console.log(`[Prepare] Player: ${player}, Grid: ${gridWidth}x${gridWidth}`);
    console.log(`[Prepare] Salt: ${backendSalt.slice(0, 18)}..., Hash: ${backendSaltHash.slice(0, 18)}...`);

    
    try {
      const result = await sendSyncTx('commitSaltHash', [player, backendSaltHash], 3000000);
      if (result.status !== 1) {
        return res.status(500).json({ success: false, error: 'Failed to commit salt on-chain' });
      }
      console.log(`[Prepare] Salt committed on-chain: ${result.hash}`);
    } catch (err) {
      console.error('[Prepare] CommitSalt TX failed:', err.message);
      return res.status(500).json({ success: false, error: 'Failed to commit salt: ' + err.message });
    }

    // Save salt to DB for later reveal
    await db.savePendingSalt(backendSaltHash, backendSalt, player);
    pendingSaltCache.set(player.toLowerCase(), {
      salt: backendSalt,
      saltHash: backendSaltHash,
      gridSize: gridWidth,
      cachedAt: Date.now()
    });

    
    // Player doesn't know bomb positions until game ends
    res.json({
      success: true,
      ready: true,
      gridSize: gridWidth
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// REVEAL TILE
// ═══════════════════════════════════════════════════════════════
const pendingReveals = new Map();
const revealedTilesCache = new Map();

app.post('/api/game/:gameId/reveal', async (req, res) => {
  try {
    const gameId = req.params.gameId;
    const { tileIndex } = req.body;
    const token = req.headers['x-session-token'];

    const player = validateSession(token);
    if (!player) return res.status(401).json({ success: false, error: 'Invalid session' });

    const tileIdx = parseInt(tileIndex);
    const game = await db.getGame(gameId);
    if (!game) return res.status(404).json({ success: false, error: 'Game not found' });

    const gridWidth = game.grid_size || 5;
    const config = getGridConfig(gridWidth);

    if (isNaN(tileIdx) || tileIdx < 0 || tileIdx >= config.size) {
      return res.status(400).json({ success: false, error: 'Invalid tile index' });
    }

    if (game.player.toLowerCase() !== player.toLowerCase()) {
      return res.status(403).json({ success: false, error: 'Not your game' });
    }
    if (game.phase !== 'active') {
      return res.status(400).json({ success: false, error: 'Game not active' });
    }
    if (!game.vrf_seed || !game.backend_salt) {
      return res.status(400).json({ success: false, error: 'Seeds not ready' });
    }

    // Get fox position
    const foxPos = game.fox_position !== undefined ? game.fox_position : game.start_tile;

    // Movement validation
    if (!isAdjacent4Way(foxPos, tileIdx, gridWidth)) {
      return res.status(400).json({ success: false, error: 'Not adjacent (4 directions only)' });
    }

    // Check backward movement - cannot go to lower row
    const currentRow = Math.floor(foxPos / gridWidth);
    const newRow = Math.floor(tileIdx / gridWidth);
    if (newRow > currentRow) {
      return res.status(400).json({ success: false, error: "You can't go back!" });
    }

    // Check if already revealed
    const gameIdStr = gameId.toString();
    let cachedRevealed = revealedTilesCache.get(gameIdStr);
    if (!cachedRevealed) {
      cachedRevealed = new Set(game.revealed_tiles || []);
      revealedTilesCache.set(gameIdStr, cachedRevealed);
    }

    if (cachedRevealed.has(tileIdx)) {
      return res.status(400).json({ success: false, error: "You can't go back!" });
    }

    // Check pending
    const pendingKey = `${gameId}:${tileIdx}`;
    if (pendingReveals.has(pendingKey)) {
      return res.json({ success: true, pending: true });
    }
    pendingReveals.set(pendingKey, Date.now());
    cachedRevealed.add(tileIdx);

    
    const finalSeed = calculateFinalSeed(game.vrf_seed, game.backend_salt, gameId);
    const bombSet = new Set(game.bomb_positions || []);

    const isFinishTile = tileIdx === game.finish_tile;
    let tileType, reward = 0n;

    if (bombSet.has(tileIdx)) {
      tileType = TileType.BOMB;
    } else if (isFinishTile) {
      tileType = TileType.EMPTY;
    } else if (isRewardTile(finalSeed, gameId, bombSet, game.start_tile, game.finish_tile, tileIdx, gridWidth)) {
      tileType = TileType.REWARD;
      reward = getTileReward(finalSeed, gameId, game.bet_amount, tileIdx);
    } else {
      tileType = TileType.EMPTY;
    }

    console.log(`[Reveal] Game ${gameId}, Grid ${gridWidth}x${gridWidth}, Tile ${tileIdx}, Type: ${['EMPTY','BOMB','REWARD'][tileType]}, Finish: ${isFinishTile}`);

    try {
      const result = await sendSyncTx('revealTile', [player, BigInt(gameId), tileIdx, tileType, reward], 3000000);
      pendingReveals.delete(pendingKey);

      if (result.status === 1) {
        await db.updateFoxPosition(gameId, tileIdx);

        // Handle bomb hit
        if (tileType === TileType.BOMB) {
          console.log(`[Reveal] BOMB HIT! Game ${gameId}`);

          // Calculate missed rewards
          const missedRewards = calculateMissedRewards(finalSeed, gameId, bombSet, game.start_tile, game.finish_tile, game.bet_amount, cachedRevealed, gridWidth);

          
          sendSyncTx('completeGame', [BigInt(gameId), game.backend_salt, game.map_nonce || 0], 3000000)
            .then(async () => {
              await db.completeGame(gameId, false, '0', Array.from(bombSet), []);
              broadcastToGame(gameId, {
                type: 'gameCompleted',
                gameId,
                won: false,
                payout: '0',
                bombPositions: Array.from(bombSet),
                missedRewards
              });
            })
            .catch(err => console.error('[CompleteGame] Error:', err.message));

          return res.json({
            success: true,
            txHash: result.hash,
            tileType,
            isBomb: true,
            isReward: false,
            isEmpty: false,
            reward: '0',
            tileIndex: tileIdx,
            gameOver: true,
            missedRewards
          });
        }

        // Handle finish tile reached
        if (isFinishTile) {
          console.log(`[Reveal] FINISH REACHED! Game ${gameId}`);

          // Calculate missed rewards
          const missedRewards = calculateMissedRewards(finalSeed, gameId, bombSet, game.start_tile, game.finish_tile, game.bet_amount, cachedRevealed, gridWidth);

          // Complete game on-chain (triggers payout)
          sendSyncTx('completeGame', [BigInt(gameId), game.backend_salt, game.map_nonce || 0], 3000000)
            .then(async () => {
              await db.completeGame(gameId, true, game.collected_reward || '0', Array.from(bombSet), []);
              broadcastToGame(gameId, {
                type: 'gameCompleted',
                gameId,
                won: true,
                payout: game.collected_reward || '0',
                bombPositions: Array.from(bombSet),
                missedRewards
              });
            })
            .catch(err => console.error('[CompleteGame] Error:', err.message));

          return res.json({
            success: true,
            txHash: result.hash,
            tileType: TileType.EMPTY,
            isBomb: false,
            isReward: false,
            isEmpty: true,
            reward: '0',
            tileIndex: tileIdx,
            finishReached: true,
            gameOver: true,
            missedRewards
          });
        }

        return res.json({
          success: true,
          txHash: result.hash,
          tileType,
          isBomb: false,
          isReward: tileType === TileType.REWARD,
          isEmpty: tileType === TileType.EMPTY,
          reward: reward.toString(),
          rewardFormatted: ethers.formatEther(reward),
          tileIndex: tileIdx
        });
      } else {
        return res.status(500).json({ success: false, error: 'Transaction failed' });
      }
    } catch (err) {
      pendingReveals.delete(pendingKey);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    let contractBalance = '0';
    try {
      contractBalance = (await contract.contractBalance()).toString();
    } catch {}
    res.json({ success: true, stats: { ...stats, contract_balance: contractBalance } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Player games
app.get('/api/games/player/:address', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const { games, total } = await db.getPlayerGames(req.params.address, limit, offset);
    res.json({ success: true, games, pagination: { total, limit, offset, hasMore: offset + games.length < total } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Recent games
app.get('/api/games/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const { games, total } = await db.getRecentGames(limit, offset);
    res.json({ success: true, games, total, pagination: { limit, offset, hasMore: offset + games.length < total } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════════

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    wsClients.set(ws, { subscriptions: new Set() });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'subscribe' && message.gameId) {
          wsClients.get(ws).subscriptions.add(message.gameId);
          if (!gameSubscribers.has(message.gameId)) gameSubscribers.set(message.gameId, new Set());
          gameSubscribers.get(message.gameId).add(ws);
          ws.send(JSON.stringify({ type: 'subscribed', gameId: message.gameId }));
        }
        if (message.type === 'unsubscribe' && message.gameId) {
          wsClients.get(ws).subscriptions.delete(message.gameId);
          const subs = gameSubscribers.get(message.gameId);
          if (subs) { subs.delete(ws); if (subs.size === 0) gameSubscribers.delete(message.gameId); }
        }
      } catch {}
    });

    ws.on('close', () => {
      const client = wsClients.get(ws);
      if (client) {
        client.subscriptions.forEach(gameId => {
          const subs = gameSubscribers.get(gameId);
          if (subs) { subs.delete(ws); if (subs.size === 0) gameSubscribers.delete(gameId); }
        });
      }
      wsClients.delete(ws);
    });
  });

  console.log('WebSocket server started');
}

// ═══════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════

async function start() {
  try {
    await db.connectDB();

    provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    wallet = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
    contract = new ethers.Contract(process.env.BOMBOMB_CONTRACT_ADDRESS, BOMBOMB_ABI, wallet);

    nonceManager = new NonceManager(wallet, provider);
    await nonceManager.initialize();

    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    const viemAccount = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);

    viemWalletClient = createWalletClient({
      account: viemAccount,
      chain: { ...monad, rpcUrls: { default: { http: [process.env.RPC_URL] } } },
      transport: http(process.env.RPC_URL)
    });

    console.log('Relayer:', wallet.address);
    console.log('Contract:', process.env.BOMBOMB_CONTRACT_ADDRESS);

    const server = app.listen(PORT, () => console.log(`Walkie server on port ${PORT}`));
    setupWebSocket(server);

    eventListener = new EventListener(
      process.env.WS_URL,
      process.env.BOMBOMB_CONTRACT_ADDRESS,
      broadcast,
      {
        getSaltByHash: async (saltHash) => {
          // Try cache first
          for (const [player, data] of pendingSaltCache) {
            if (data.saltHash === saltHash) {
              pendingSaltCache.delete(player);
              db.deletePendingSalt(saltHash).catch(() => {});
              return data;
            }
          }
          // Try DB
          const dbSalt = await db.getPendingSaltByHash(saltHash);
          if (dbSalt) {
            db.deletePendingSalt(saltHash).catch(() => {});
            return { salt: dbSalt.salt, player: dbSalt.player };
          }
          return null;
        },
        getSaltForPlayer: async (playerAddress) => {
          const playerLower = playerAddress.toLowerCase();
          // Try cache first
          if (pendingSaltCache.has(playerLower)) {
            const data = pendingSaltCache.get(playerLower);
            pendingSaltCache.delete(playerLower);
            db.deletePendingSalt(data.saltHash).catch(() => {});
            return data;
          }
          // Try DB
          const dbSalt = await db.getPendingSaltByPlayer(playerAddress);
          if (dbSalt) {
            db.deletePendingSalt(dbSalt.salt_hash).catch(() => {});
            return { salt: dbSalt.salt, player: dbSalt.player };
          }
          return null;
        }
      },
      
      sendSyncTx
    );
    await eventListener.start();

    process.on('SIGINT', async () => { await eventListener.stop(); server.close(); process.exit(0); });
    process.on('SIGTERM', async () => { await eventListener.stop(); server.close(); process.exit(0); });

  } catch (error) {
    console.error('Startup error:', error);
    process.exit(1);
  }
}

start();
