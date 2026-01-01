const CONFIG = {
  API_URL: 'https://walkie.monaliens.xyz/api',
  WS_URL: 'wss://walkie.monaliens.xyz/ws',

  CHAIN_ID: 143,
  CHAIN_NAME: 'Monad Mainnet',
  RPC_URL: 'https://rpc.mainnet.vitrioll.com',
  EXPLORER_URL: 'https://explorer.mainnet.vitrioll.com',
  CURRENCY: {
    name: 'MON',
    symbol: 'MON',
    decimals: 18
  },

  CONTRACT_ADDRESS: '0x7f7B8135d5D4ba22d3acA7f40676Ba9D89FDe731',

  // Default grid settings
  DEFAULT_GRID_SIZE: 5,
  MIN_BET: 0.1,
  MAX_BET: 10,

  // Grid configurations
  GRIDS: {
    5: {
      size: 25,
      width: 5,
      bombs: 3,
      minRewards: 5,
      maxRewards: 8,
      label: '5x5',
      description: '3 Traps'
    },
    6: {
      size: 36,
      width: 6,
      bombs: 5,
      minRewards: 7,
      maxRewards: 10,
      label: '6x6',
      description: '5 Traps'
    },
    7: {
      size: 49,
      width: 7,
      bombs: 7,
      minRewards: 10,
      maxRewards: 14,
      label: '7x7',
      description: '7 Traps'
    }
  },

  // Tile types
  TILE_TYPE: {
    EMPTY: 0,
    BOMB: 1,
    REWARD: 2
  },

  // Reward tiers (in basis points, must match contract)
  // 0.1x, 0.2x, 0.5x, 1x, 2x, 5x, 10x
  REWARD_TIERS: [1000, 2000, 5000, 10000, 20000, 50000, 100000],
  TIER_THRESHOLDS: [3500, 6000, 8000, 9200, 9700, 9950, 10000],
  TIER_LABELS: ['0.1x', '0.2x', '0.5x', '1x', '2x', '5x', '10x'],
  TIER_CHANCES: ['35%', '25%', '20%', '12%', '5%', '2.5%', '0.5%'],

  // Session
  SESSION_KEY: 'bombomb_session_token',

  CONTRACT_ABI: [
    'function startGame(bytes32 backendSaltHash, uint8 _gridSize, uint8 _startTile, uint8 _finishTile, uint64 _bombBitmap) external payable',
    'function getEntropyFee() external view returns (uint128)',
    'function getGame(uint64 gameId) external view returns (tuple(address player, uint256 betAmount, uint8 revealedCount, uint256 collectedReward, bytes32 vrfCommitment, bytes32 backendSaltHash, uint8 phase, bool won, uint256 payout, uint256 timestamp))',
    'function getGameTiles(uint64 gameId) external view returns (uint8 gridSize, uint8 startTile, uint8 finishTile, uint8 foxPosition, uint256 revealedTiles, uint64 bombBitmap)',
    'function getActiveGame(address player) external view returns (uint64)',
    'function isTileRevealed(uint64 gameId, uint8 tileIndex) external view returns (bool)',
    'function getBombCountForGrid(uint8 gridWidth) external pure returns (uint8)',
    'event GameStarted(uint64 indexed gameId, address indexed player, uint256 betAmount, uint64 sequenceNumber, uint8 gridSize)',
    'event GameReady(uint64 indexed gameId, uint8 startTile, uint8 finishTile, uint8 gridSize)',
    'event TileRevealed(uint64 indexed gameId, address indexed player, uint8 tileIndex, uint8 tileType, uint256 reward, uint256 totalCollected, uint8 revealedCount)',
    'event BombHit(uint64 indexed gameId, address indexed player, uint8 tileIndex, uint256 betLost)',
    'event FinishReached(uint64 indexed gameId, address indexed player, uint256 payout, uint8 revealedCount)',
    'event GameCompleted(uint64 indexed gameId, address indexed player, bool won, uint256 payout, uint8 revealedCount, bytes32 finalSeed)'
  ],

  // Helper functions
  getGridConfig(gridSize) {
    return this.GRIDS[gridSize] || this.GRIDS[5];
  },

  getStartTiles(gridSize) {
    const config = this.getGridConfig(gridSize);
    const tiles = [];
    for (let i = config.size - config.width; i < config.size; i++) {
      tiles.push(i);
    }
    return tiles;
  },

  getFinishTiles(gridSize) {
    const config = this.getGridConfig(gridSize);
    const tiles = [];
    for (let i = 0; i < config.width; i++) {
      tiles.push(i);
    }
    return tiles;
  }
};

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
