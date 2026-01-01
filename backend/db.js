const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════

const GameSchema = new mongoose.Schema({
  game_id: { type: String, required: true, unique: true, index: true },
  player: { type: String, required: true, index: true },
  bet_amount: { type: String, required: true },
  grid_size: { type: Number, default: 5 },  // Grid width: 5, 6, or 7
  revealed_count: { type: Number, default: 0 },
  collected_reward: { type: String, default: '0' },
  revealed_tiles: [{ type: Number }],
  fox_position: { type: Number },
  start_tile: { type: Number },      // Starting position (bottom row)
  finish_tile: { type: Number },     // Finish position (top row)
  bomb_bitmap: { type: String },     // Bitmap of bomb positions (string for uint64)
  phase: {
    type: String,
    enum: ['none', 'waiting_vrf', 'active', 'completed'],
    default: 'waiting_vrf',
    index: true
  },
  won: { type: Boolean, default: false },
  payout: { type: String, default: '0' },
  backend_salt_hash: { type: String },
  vrf_commitment: { type: String },
  vrf_seed: { type: String },
  backend_salt: { type: String },
  bomb_positions: [{ type: Number }],
  map_nonce: { type: Number, default: 0 },  
  tile_rewards: [{
    index: { type: Number },
    isBomb: { type: Boolean },
    isReward: { type: Boolean },
    reward: { type: String }
  }],
  tx_hash: { type: String }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

GameSchema.index({ player: 1, phase: 1 });
GameSchema.index({ updated_at: -1 });

const ActionSchema = new mongoose.Schema({
  game_id: { type: String, required: true, index: true },
  action_type: { type: String, required: true },
  tile_index: { type: Number },
  tile_type: { type: Number },
  is_bomb: { type: Boolean },
  is_reward: { type: Boolean },
  is_empty: { type: Boolean },
  reward: { type: String },
  total_collected: { type: String },
  revealed_count: { type: Number },
  tx_hash: { type: String },
  block_number: { type: Number }
}, {
  timestamps: { createdAt: 'created_at' }
});

ActionSchema.index({ game_id: 1, created_at: 1 });

const PendingSaltSchema = new mongoose.Schema({
  salt_hash: { type: String, required: true, unique: true, index: true },
  salt: { type: String, required: true },
  player: { type: String, required: true, index: true },
  grid_size: { type: Number, default: 5 },
  start_tile: { type: Number },
  finish_tile: { type: Number },
  bomb_bitmap: { type: String },  // String for uint64
  created_at: { type: Date, default: Date.now, expires: 2592000 }
});

// ═══════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════

const Game = mongoose.model('BombombGame', GameSchema);
const Action = mongoose.model('BombombAction', ActionSchema);
const PendingSalt = mongoose.model('BombombPendingSalt', PendingSaltSchema);

// ═══════════════════════════════════════════════════════════════
// DATABASE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

async function getGame(gameId) {
  return Game.findOne({ game_id: gameId.toString() });
}

async function getActiveGame(playerAddress) {
  return Game.findOne({
    player: playerAddress.toLowerCase(),
    phase: { $in: ['waiting_vrf', 'active'] }
  });
}

async function createOrUpdateGame(gameData) {
  const filter = { game_id: gameData.game_id };
  const update = { ...gameData, player: gameData.player.toLowerCase() };
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  return Game.findOneAndUpdate(filter, update, options);
}

async function updateGamePhase(gameId, phase) {
  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    { phase },
    { new: true }
  );
}

async function updateGameSeeds(gameId, vrfSeed, backendSalt) {
  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    { vrf_seed: vrfSeed, backend_salt: backendSalt },
    { new: true }
  );
}

async function updateGameTileData(gameId, bombPositions, tileRewards) {
  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    { bomb_positions: bombPositions, tile_rewards: tileRewards },
    { new: true }
  );
}


async function updateGameMap(gameId, startTile, finishTile, bombPositions, mapNonce) {
  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    {
      start_tile: startTile,
      finish_tile: finishTile,
      fox_position: startTile,
      bomb_positions: bombPositions,
      map_nonce: mapNonce,
      revealed_tiles: [startTile],  // Auto-reveal start
      revealed_count: 1
    },
    { new: true }
  );
}

async function updateGameReveal(gameId, tileIndex, reward, totalCollected, revealedCount) {
  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    {
      $push: { revealed_tiles: tileIndex },
      collected_reward: totalCollected,
      revealed_count: revealedCount
    },
    { new: true }
  );
}

async function updateFoxPosition(gameId, position) {
  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    { fox_position: position },
    { new: true }
  );
}

async function addTileReward(gameId, tileRewardData) {
  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    {
      $push: { tile_rewards: tileRewardData }
    },
    { new: true }
  );
}

async function completeGame(gameId, won, payout, bombPositions, tileRewards) {
  const updateData = {
    phase: 'completed',
    won,
    payout: payout.toString()
  };

  if (bombPositions && bombPositions.length > 0) {
    updateData.bomb_positions = bombPositions;
  }
  if (tileRewards && tileRewards.length > 0) {
    updateData.tile_rewards = tileRewards;
  }

  return Game.findOneAndUpdate(
    { game_id: gameId.toString() },
    updateData,
    { new: true }
  );
}

async function getPlayerGames(playerAddress, limit = 20, offset = 0) {
  const player = playerAddress.toLowerCase();
  const [games, total] = await Promise.all([
    Game.find({ player, phase: 'completed' }).sort({ updated_at: -1 }).skip(offset).limit(limit),
    Game.countDocuments({ player, phase: 'completed' })
  ]);
  return { games, total };
}

async function getRecentGames(limit = 20, offset = 0) {
  const [games, total] = await Promise.all([
    Game.find({ phase: 'completed' }).sort({ updated_at: -1 }).skip(offset).limit(limit),
    Game.countDocuments({ phase: 'completed' })
  ]);
  return { games, total };
}

async function getStats() {
  const result = await Game.aggregate([
    { $match: { phase: 'completed' } },
    {
      $group: {
        _id: null,
        total_games: { $sum: 1 },
        total_volume: { $sum: { $convert: { input: '$bet_amount', to: 'double', onError: 0, onNull: 0 } } },
        total_payout: { $sum: { $convert: { input: '$payout', to: 'double', onError: 0, onNull: 0 } } },
        total_wins: { $sum: { $cond: ['$won', 1, 0] } },
        total_losses: { $sum: { $cond: ['$won', 0, 1] } }
      }
    }
  ]);

  return result[0] || { total_games: 0, total_volume: 0, total_payout: 0, total_wins: 0, total_losses: 0 };
}

async function createAction(actionData) {
  const action = new Action(actionData);
  return action.save();
}

async function getGameActions(gameId) {
  return Action.find({ game_id: gameId.toString() }).sort({ created_at: 1 });
}

async function savePendingSalt(saltHash, salt, player, startTile, finishTile, bombBitmap) {
  const pendingSalt = new PendingSalt({
    salt_hash: saltHash,
    salt,
    player: player.toLowerCase(),
    start_tile: startTile,
    finish_tile: finishTile,
    bomb_bitmap: bombBitmap
  });

  try {
    await pendingSalt.save();
  } catch (err) {
    if (err.code === 11000) {
      await PendingSalt.findOneAndUpdate(
        { salt_hash: saltHash },
        { salt, player: player.toLowerCase(), start_tile: startTile, finish_tile: finishTile, bomb_bitmap: bombBitmap, created_at: new Date() }
      );
    } else {
      throw err;
    }
  }
}

async function getPendingSaltByHash(saltHash) {
  return PendingSalt.findOne({ salt_hash: saltHash });
}

async function getPendingSaltByPlayer(playerAddress) {
  return PendingSalt.findOne({ player: playerAddress.toLowerCase() }).sort({ created_at: -1 });
}

async function deletePendingSalt(saltHash) {
  return PendingSalt.deleteOne({ salt_hash: saltHash });
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  connectDB,
  Game,
  Action,
  PendingSalt,
  getGame,
  getActiveGame,
  createOrUpdateGame,
  updateGamePhase,
  updateGameSeeds,
  updateGameTileData,
  updateGameMap,
  updateGameReveal,
  updateFoxPosition,
  addTileReward,
  completeGame,
  getPlayerGames,
  getRecentGames,
  getStats,
  createAction,
  getGameActions,
  savePendingSalt,
  getPendingSaltByHash,
  getPendingSaltByPlayer,
  deletePendingSalt
};
