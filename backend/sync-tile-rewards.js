/**
 * Sync tile_rewards from Actions table to Games table
 * This script backfills tile_rewards for games that were played before
 * the tile_rewards tracking was implemented.
 * 
 * Run: node sync-tile-rewards.js
 */

const path = require('path');
const fs = require('fs');
const localEnv = path.join(__dirname, '.env');
const parentEnv = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : parentEnv });

const mongoose = require('mongoose');
const db = require('./db');

async function syncTileRewards() {
  try {
    // Connect to MongoDB
    await db.connectDB();
    console.log('Connected to MongoDB');

    // Find all completed games
    const games = await db.Game.find({ phase: 'completed' });
    console.log(`Found ${games.length} completed games`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const game of games) {
      // Skip if tile_rewards already has data
      if (game.tile_rewards && game.tile_rewards.length > 0) {
        skippedCount++;
        continue;
      }

      // Get actions for this game
      const actions = await db.Action.find({ 
        game_id: game.game_id,
        is_reward: true,
        reward: { $ne: '0', $exists: true }
      });

      if (actions.length === 0) {
        skippedCount++;
        continue;
      }

      // Build tile_rewards array from actions
      const tileRewards = actions.map(action => ({
        index: action.tile_index,
        isBomb: false,
        isReward: true,
        reward: action.reward
      }));

      // Update game with tile_rewards
      await db.Game.updateOne(
        { game_id: game.game_id },
        { $set: { tile_rewards: tileRewards } }
      );

      console.log(`Game ${game.game_id}: Added ${tileRewards.length} tile rewards`);
      updatedCount++;
    }

    console.log('\n=== Sync Complete ===');
    console.log(`Updated: ${updatedCount} games`);
    console.log(`Skipped: ${skippedCount} games (already had tile_rewards or no rewards)`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run
syncTileRewards();
