const { ethers } = require('ethers');
const db = require('./db');

const VERSION = ethers.keccak256(ethers.toUtf8Bytes('WALKIE_V5_PROVABLY_FAIR'));

// Grid configurations
const GRID_CONFIG = {
  5: { size: 25, bombs: 3 },
  6: { size: 36, bombs: 5 },
  7: { size: 49, bombs: 7 }
};

// Tile type enum
const TileType = {
  EMPTY: 0,
  BOMB: 1,
  REWARD: 2
};

// ═══════════════════════════════════════════════════════════════
// MAP GENERATION HELPERS (must match contract exactly!)
// ═══════════════════════════════════════════════════════════════

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

function selectStartAndFinish(finalSeed, gameId, gridWidth) {
  const totalTiles = gridWidth * gridWidth;

  // Start tiles (bottom row)
  const startTiles = [];
  for (let i = totalTiles - gridWidth; i < totalTiles; i++) {
    startTiles.push(i);
  }

  // Finish tiles (top row)
  const finishTiles = [];
  for (let i = 0; i < gridWidth; i++) {
    finishTiles.push(i);
  }

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

function placeBombsWithNonce(finalSeed, gameId, startTile, finishTile, gridWidth) {
  const config = GRID_CONFIG[gridWidth] || GRID_CONFIG[5];
  const totalTiles = config.size;
  const bombCount = config.bombs;
  const maxAttempts = 100;

  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    const bombs = new Set();
    const available = [];

    for (let i = 0; i < totalTiles; i++) {
      if (i !== startTile && i !== finishTile) available.push(i);
    }

    for (let i = 0; i < bombCount; i++) {
      const hash = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32', 'uint64', 'string', 'uint8', 'uint8', 'bytes32'],
          [finalSeed, BigInt(gameId), 'bomb', nonce, i, VERSION]
        )
      );
      const j = i + Number(BigInt(hash) % BigInt(available.length - i));
      [available[i], available[j]] = [available[j], available[i]];
      bombs.add(available[i]);
    }

    if (hasPath(startTile, finishTile, bombs, gridWidth)) {
      return { bombSet: bombs, nonce };
    }
  }

  console.error('[EventListener] Could not find valid map');
  return { bombSet: new Set([5, 9, 15]), nonce: 0 };
}

function calculateFinalSeed(pythSeed, backendSalt, gameId) {
  return ethers.keccak256(
    ethers.solidityPacked(['bytes32', 'bytes32', 'uint64', 'bytes32'], [pythSeed, backendSalt, BigInt(gameId), VERSION])
  );
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENER CLASS
// ═══════════════════════════════════════════════════════════════

class EventListener {
  constructor(wsUrl, contractAddress, broadcast, saltCallbacks, sendSyncTx) {
    this.wsUrl = wsUrl;
    this.contractAddress = contractAddress;
    this.broadcast = broadcast;
    this.saltCallbacks = saltCallbacks;
    this.sendSyncTx = sendSyncTx;  
    this.provider = null;
    this.contract = null;
    this.isRunning = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.connect();
  }

  async stop() {
    this.isRunning = false;
    if (this.provider) {
      this.provider.removeAllListeners();
      if (this.provider.websocket) {
        this.provider.websocket.close();
      }
    }
    console.log('[EventListener] Stopped');
  }

  async connect() {
    try {
      console.log(`[EventListener] Connecting to ${this.wsUrl}`);

      this.provider = new ethers.WebSocketProvider(this.wsUrl);

      const iface = new ethers.Interface([
        'event SaltCommitted(address indexed player, bytes32 saltHash)',
        'event GameStarted(uint64 indexed gameId, address indexed player, uint256 betAmount, uint64 sequenceNumber, uint8 gridSize)',
        'event VRFReceived(uint64 indexed gameId)',
        'event GameReady(uint64 indexed gameId, uint8 startTile, uint8 finishTile, uint8 gridSize)',
        'event TileRevealed(uint64 indexed gameId, address indexed player, uint8 tileIndex, uint8 tileType, uint256 reward, uint256 totalCollected, uint8 revealedCount)',
        'event BombHit(uint64 indexed gameId, address indexed player, uint8 tileIndex, uint256 betLost)',
        'event FinishReached(uint64 indexed gameId, address indexed player, uint256 payout, uint8 revealedCount)',
        'event GameCompleted(uint64 indexed gameId, address indexed player, bool won, uint256 payout, uint8 revealedCount, bytes32 finalSeed)'
      ]);

      const filter = { address: this.contractAddress };

      this.provider.on(filter, async (log) => {
        try {
          const parsed = iface.parseLog(log);
          if (!parsed) return;
          await this.handleEvent(parsed.name, parsed.args, log);
        } catch (err) {
          console.error('[EventListener] Parse error:', err.message);
        }
      });

      this.provider.websocket.on('close', () => {
        console.log('[EventListener] WebSocket closed');
        if (this.isRunning) this.scheduleReconnect();
      });

      this.provider.websocket.on('error', (err) => {
        console.error('[EventListener] WebSocket error:', err.message);
      });

      this.reconnectAttempts = 0;
      console.log('[EventListener] Connected and listening');

    } catch (error) {
      console.error('[EventListener] Connection error:', error.message);
      if (this.isRunning) this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[EventListener] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);
    console.log(`[EventListener] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (this.isRunning) this.connect();
    }, delay);
  }

  async handleEvent(name, args, log) {
    const gameId = args.gameId?.toString() || args[0]?.toString();
    console.log(`[Event] ${name} - gameId: ${gameId || 'N/A'}`);

    try {
      switch (name) {
        case 'GameStarted':
          await this.handleGameStarted(args, log);
          break;

        case 'VRFReceived':
          await this.handleVRFReceived(args, log);
          break;

        case 'GameReady':
          await this.handleGameReady(args, log);
          break;

        case 'TileRevealed':
          await this.handleTileRevealed(args, log);
          break;

        case 'BombHit':
          await this.handleBombHit(args, log);
          break;

        case 'FinishReached':
          await this.handleFinishReached(args, log);
          break;

        case 'GameCompleted':
          await this.handleGameCompleted(args, log);
          break;
      }
    } catch (err) {
      console.error(`[Event] Error handling ${name}:`, err.message);
    }
  }

  async handleGameStarted(args, log) {
    const gameId = args.gameId.toString();
    const player = args.player.toLowerCase();
    const betAmount = args.betAmount.toString();
    const gridSize = Number(args.gridSize);

    console.log(`[GameStarted] Game ${gameId} - Player: ${player}, Bet: ${ethers.formatEther(betAmount)} MON, Grid: ${gridSize}x${gridSize}`);

    // Fetch salt hash from contract
    let backendSaltHash = null;
    try {
      const contractAbi = [
        'function games(uint64) view returns (address,uint256,uint8,uint256,bytes32,bytes32,uint8,bool,uint256,uint256,bytes32)'
      ];
      const contract = new ethers.Contract(this.contractAddress, contractAbi, this.provider);
      const gameData = await contract.games(BigInt(gameId));
      backendSaltHash = gameData[5];
    } catch (err) {
      console.error(`[GameStarted] Failed to fetch salt hash:`, err.message);
    }

    // Create game in DB (waiting for VRF)
    await db.createOrUpdateGame({
      game_id: gameId,
      player,
      bet_amount: betAmount,
      grid_size: gridSize,
      revealed_count: 0,
      collected_reward: '0',
      revealed_tiles: [],
      phase: 'waiting_vrf',
      won: false,
      payout: '0',
      tx_hash: log.transactionHash,
      backend_salt_hash: backendSaltHash
    });

    this.broadcast({
      type: 'gameStarted',
      gameId,
      player,
      betAmount,
      gridSize
    }, gameId);
  }

  async handleVRFReceived(args, log) {
    const gameId = args.gameId.toString();
    console.log(`[VRFReceived] Game ${gameId} - VRF callback received`);

    const game = await db.getGame(gameId);
    if (!game) {
      console.error(`[VRFReceived] Game ${gameId} not found`);
      return;
    }

    // Extract pythSeed from Entropy event
    const receipt = await this.provider.getTransactionReceipt(log.transactionHash);
    let pythSeed = null;

    if (receipt && receipt.logs) {
      const ENTROPY_ADDRESS = '0xD458261E832415CFd3BAE5E416FdF3230ce6F134'.toLowerCase();
      for (const eventLog of receipt.logs) {
        if (eventLog.address.toLowerCase() === ENTROPY_ADDRESS && eventLog.topics.length === 4) {
          pythSeed = '0x' + eventLog.data.slice(2, 66);
          console.log(`[VRFReceived] Extracted pythSeed: ${pythSeed.slice(0, 18)}...`);
          break;
        }
      }
    }

    if (!pythSeed) {
      console.error(`[VRFReceived] Could not extract pythSeed`);
      return;
    }

    // Get backend salt
    let backendSalt = null;
    let saltData = null;

    if (game.backend_salt_hash) {
      saltData = await this.saltCallbacks.getSaltByHash(game.backend_salt_hash);
      if (saltData) backendSalt = saltData.salt;
    }

    if (!backendSalt) {
      saltData = await this.saltCallbacks.getSaltForPlayer(game.player);
      if (saltData) backendSalt = saltData.salt;
    }

    if (!backendSalt) {
      console.error(`[VRFReceived] Could not find backendSalt for game ${gameId}`);
      return;
    }

    
    const finalSeed = calculateFinalSeed(pythSeed, backendSalt, gameId);
    const gridWidth = game.grid_size || 5;

    const { startTile, finishTile } = selectStartAndFinish(finalSeed, gameId, gridWidth);
    const { bombSet, nonce } = placeBombsWithNonce(finalSeed, gameId, startTile, finishTile, gridWidth);

    console.log(`[VRFReceived] Game ${gameId} - Start: ${startTile}, Finish: ${finishTile}, Nonce: ${nonce}, Bombs: ${Array.from(bombSet)}`);

    // Update DB with seeds and map info
    await db.updateGameSeeds(gameId, pythSeed, backendSalt);
    await db.updateGameMap(gameId, startTile, finishTile, Array.from(bombSet), nonce);

    
    try {
      const result = await this.sendSyncTx('setGameTiles', [BigInt(gameId), startTile, finishTile], 3000000);
      if (result.status === 1) {
        console.log(`[VRFReceived] setGameTiles TX: ${result.hash}`);
      } else {
        console.error(`[VRFReceived] setGameTiles failed`);
      }
    } catch (err) {
      console.error(`[VRFReceived] setGameTiles error:`, err.message);
    }
  }

  async handleGameReady(args, log) {
    const gameId = args.gameId.toString();
    const startTileVal = Number(args.startTile);
    const finishTileVal = Number(args.finishTile);
    const gridSize = Number(args.gridSize);

    console.log(`[GameReady] Game ${gameId} - Start: ${startTileVal}, Finish: ${finishTileVal}`);

    // Update phase
    await db.updateGamePhase(gameId, 'active');

    // Broadcast
    this.broadcast({
      type: 'vrfReceived',
      gameId,
      gridSize,
      startTile: startTileVal,
      finishTile: finishTileVal,
      ready: true
    }, gameId);
  }

  async handleTileRevealed(args, log) {
    const gameId = args.gameId.toString();
    const player = args.player.toLowerCase();
    const tileIndex = Number(args.tileIndex);
    const tileType = Number(args.tileType);
    const reward = args.reward.toString();
    const totalCollected = args.totalCollected.toString();
    const revealedCount = Number(args.revealedCount);

    const tileTypeName = tileType === TileType.BOMB ? 'BOMB' : tileType === TileType.REWARD ? 'REWARD' : 'EMPTY';
    console.log(`[TileRevealed] Game ${gameId} - Tile: ${tileIndex}, Type: ${tileTypeName}`);

    await db.updateGameReveal(gameId, tileIndex, reward, totalCollected, revealedCount);

    const isBomb = tileType === TileType.BOMB;
    const isReward = tileType === TileType.REWARD;

    if (isReward && reward !== '0') {
      await db.addTileReward(gameId, {
        index: tileIndex,
        isBomb: false,
        isReward: true,
        reward: reward
      });
    }

    await db.createAction({
      game_id: gameId,
      action_type: isBomb ? 'bomb_hit' : isReward ? 'reward' : 'empty',
      tile_index: tileIndex,
      tile_type: tileType,
      is_bomb: isBomb,
      is_reward: isReward,
      is_empty: tileType === TileType.EMPTY,
      reward,
      total_collected: totalCollected,
      revealed_count: revealedCount,
      tx_hash: log.transactionHash,
      block_number: log.blockNumber
    });

    this.broadcast({
      type: 'tileRevealed',
      gameId,
      tileIndex,
      tileType,
      isBomb,
      isReward,
      isEmpty: tileType === TileType.EMPTY,
      reward,
      rewardFormatted: ethers.formatEther(reward),
      totalCollected,
      revealedCount
    }, gameId);
  }

  async handleBombHit(args, log) {
    const gameId = args.gameId.toString();
    const tileIndex = Number(args.tileIndex);
    const betLost = args.betLost.toString();

    console.log(`[BombHit] Game ${gameId} - Tile: ${tileIndex}`);

    this.broadcast({
      type: 'bombHit',
      gameId,
      tileIndex,
      betLost
    }, gameId);
  }

  async handleFinishReached(args, log) {
    const gameId = args.gameId.toString();
    const payout = args.payout.toString();
    const revealedCount = Number(args.revealedCount);

    console.log(`[FinishReached] Game ${gameId} - Payout: ${ethers.formatEther(payout)} MON`);

    await db.createAction({
      game_id: gameId,
      action_type: 'finish_reached',
      revealed_count: revealedCount,
      tx_hash: log.transactionHash,
      block_number: log.blockNumber
    });

    this.broadcast({
      type: 'finishReached',
      gameId,
      payout,
      revealedCount
    }, gameId);
  }

  async handleGameCompleted(args, log) {
    const gameId = args.gameId.toString();
    const player = args.player.toLowerCase();
    const won = args.won;
    const payout = args.payout.toString();
    const revealedCount = Number(args.revealedCount);
    const finalSeed = args.finalSeed;

    console.log(`[GameCompleted] Game ${gameId} - Won: ${won}, Payout: ${ethers.formatEther(payout)} MON`);

    // Get bomb positions from DB
    let bombPositions = [];
    const game = await db.getGame(gameId);
    if (game && game.bomb_positions) {
      bombPositions = game.bomb_positions;
    }

    await db.completeGame(gameId, won, payout, bombPositions, null);

    if (global.clearLeaderboardCache) {
      global.clearLeaderboardCache();
    }

    this.broadcast({
      type: 'gameCompleted',
      gameId,
      player,
      won,
      payout,
      revealedCount,
      bombPositions
    }, gameId);

    this.broadcast({
      type: 'recentGame',
      gameId,
      player,
      won,
      payout,
      revealedCount
    });
  }
}

module.exports = EventListener;
