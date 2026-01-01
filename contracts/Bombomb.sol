// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./pyth-entropy-sdk-solidity/IEntropyConsumer.sol";
import "./pyth-entropy-sdk-solidity/IEntropyV2.sol";

/**
 * @title Walkie - Provably Fair Path Game
 * @notice Provably fair randomness using Pyth Entropy VRF
 * @dev Dual-source randomness: VRF + backend salt, verified on-chain
 *
 *      Flow:
 *      1. Backend commits saltHash on-chain (player can't manipulate)
 *      2. Player calls startGame() with bet + VRF fee
 *      3. VRF callback provides pythSeed
 *      4. Backend calculates map from finalSeed
 *      5. Player moves, backend calls revealTile() for each move
 *      6. Game ends (bomb or finish) → Backend reveals salt in completeGame()
 *      7. Contract verifies: salt matches, recalculates map, validates all moves
 *
 *      Player never sees bombBitmap until the game is over!
 */
contract Bombomb is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IEntropyConsumer
{
    // ═══════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════

    uint256 public constant PRECISION = 10000;
    uint256 public constant FEE_PERCENT = 250;   // 2.5% house fee
    bytes32 public constant VERSION = keccak256("WALKIE_V5_PROVABLY_FAIR");

    // Reward tiers (basis points: 1000 = 0.1x)
    uint32[7] public REWARD_TIERS;
    uint16[7] public TIER_THRESHOLDS;

    // ═══════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════

    IEntropyV2 public entropy;
    address public entropyProvider;
    address public feeRecipient;
    address public relayer;

    uint256 public minBet;
    uint256 public maxBet;
    uint64 public gameCounter;

    // Statistics
    uint256 public totalGamesPlayed;
    uint256 public totalVolume;
    uint256 public totalPayout;
    uint256 public totalWins;
    uint256 public totalLosses;

    // ═══════════════════════════════════════════════════════════════
    // ENUMS & STRUCTS
    // ═══════════════════════════════════════════════════════════════

    enum GamePhase {
        None,           // 0 - No game
        WaitingVRF,     // 1 - Bet placed, waiting for VRF
        Active,         // 2 - VRF received, game active
        Completed       // 3 - Game finished
    }

    enum TileType {
        Empty,
        Bomb,
        Reward
    }

    struct Game {
        address player;
        uint256 betAmount;
        uint8 revealedCount;
        uint256 collectedReward;
        bytes32 vrfCommitment;
        bytes32 backendSaltHash;    
        GamePhase phase;
        bool won;
        uint256 payout;
        uint256 timestamp;
        bytes32 pythSeed;
    }

    // Tile reveal record for verification
    struct TileReveal {
        uint8 tileIndex;
        uint8 tileType;
        uint256 reward;
    }

    // ═══════════════════════════════════════════════════════════════
    // MAPPINGS
    // ═══════════════════════════════════════════════════════════════

    mapping(uint64 => Game) public games;
    mapping(uint64 => uint64) public vrfSeqToGame;
    mapping(address => uint64) public playerActiveGame;
    mapping(uint64 => uint256) public revealedTiles;     // Bitmap
    mapping(uint64 => uint8) public hitBombAt;           // 0 = no bomb, 1-49 = index+1
    mapping(uint64 => uint8) public foxPosition;         // Current player position
    mapping(uint64 => uint8) public startTile;           // Start position
    mapping(uint64 => uint8) public finishTile;          // Finish position
    mapping(uint64 => uint64) public bombBitmap;
    mapping(uint64 => uint8) public gameGridSize;        // Grid width (5, 6, or 7)

    
    mapping(address => bytes32) public pendingSaltHash;  // Pending salt commitments
    mapping(uint64 => TileReveal[]) public gameReveals;  // Store reveals for verification

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════

    event SaltCommitted(
        address indexed player,
        bytes32 saltHash
    );

    event GameStarted(
        uint64 indexed gameId,
        address indexed player,
        uint256 betAmount,
        uint64 sequenceNumber,
        uint8 gridSize
    );

    event VRFReceived(
        uint64 indexed gameId
    );

    event GameReady(
        uint64 indexed gameId,
        uint8 startTile,
        uint8 finishTile,
        uint8 gridSize
    );

    event TileRevealed(
        uint64 indexed gameId,
        address indexed player,
        uint8 tileIndex,
        uint8 tileType,
        uint256 reward,
        uint256 totalCollected,
        uint8 revealedCount
    );

    event BombHit(
        uint64 indexed gameId,
        address indexed player,
        uint8 tileIndex,
        uint256 betLost
    );

    event FinishReached(
        uint64 indexed gameId,
        address indexed player,
        uint256 payout,
        uint8 revealedCount
    );

    event GameCompleted(
        uint64 indexed gameId,
        address indexed player,
        bool won,
        uint256 payout,
        uint8 revealedCount,
        bytes32 finalSeed
    );

    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event BetLimitsUpdated(uint256 minBet, uint256 maxBet);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event Withdrawal(address indexed admin, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Only relayer");
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR & INITIALIZER
    // ═══════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _entropy,
        address _entropyProvider,
        uint256 _minBet,
        uint256 _maxBet,
        address _feeRecipient,
        address _relayer
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        require(_entropy != address(0), "Invalid entropy");
        require(_entropyProvider != address(0), "Invalid provider");
        require(_minBet > 0, "Min bet must be > 0");
        require(_maxBet > _minBet, "Max bet must be > min");
        require(_relayer != address(0), "Invalid relayer");

        entropy = IEntropyV2(_entropy);
        entropyProvider = _entropyProvider;
        minBet = _minBet;
        maxBet = _maxBet;
        feeRecipient = _feeRecipient;
        relayer = _relayer;

        _initializeRewardTiers();
    }

    function _initializeRewardTiers() internal {
        REWARD_TIERS[0] = 1000;
        REWARD_TIERS[1] = 2000;
        REWARD_TIERS[2] = 5000;
        REWARD_TIERS[3] = 10000;
        REWARD_TIERS[4] = 20000;
        REWARD_TIERS[5] = 50000;
        REWARD_TIERS[6] = 100000;

        TIER_THRESHOLDS[0] = 3500;
        TIER_THRESHOLDS[1] = 6000;
        TIER_THRESHOLDS[2] = 8000;
        TIER_THRESHOLDS[3] = 9200;
        TIER_THRESHOLDS[4] = 9700;
        TIER_THRESHOLDS[5] = 9950;
        TIER_THRESHOLDS[6] = 10000;
    }

    // ═══════════════════════════════════════════════════════════════
    // GRID HELPERS
    // ═══════════════════════════════════════════════════════════════

    function _getGridTotalTiles(uint8 gridWidth) internal pure returns (uint8) {
        return gridWidth * gridWidth;
    }

    function _getBombCount(uint8 gridWidth) internal pure returns (uint8) {
        if (gridWidth == 5) return 3;
        if (gridWidth == 6) return 5;
        if (gridWidth == 7) return 7;
        revert("Invalid grid size");
    }

    function _isValidGridSize(uint8 gridWidth) internal pure returns (bool) {
        return gridWidth == 5 || gridWidth == 6 || gridWidth == 7;
    }

    // ═══════════════════════════════════════════════════════════════
    // PYTH ENTROPY
    // ═══════════════════════════════════════════════════════════════

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    function entropyCallback(
        uint64 sequenceNumber,
        address,
        bytes32 randomNumber
    ) internal override {
        uint64 gameId = vrfSeqToGame[sequenceNumber];
        require(gameId != 0, "Unknown sequence");

        Game storage game = games[gameId];
        require(game.phase == GamePhase.WaitingVRF, "Invalid phase");

        // Store commitment and seed
        bytes32 commitment = keccak256(abi.encodePacked(randomNumber, gameId, VERSION));
        game.vrfCommitment = commitment;
        game.pythSeed = randomNumber;
        game.phase = GamePhase.Active;

        emit VRFReceived(gameId);
    }

    // ═══════════════════════════════════════════════════════════════
    // GAME FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Step 1: Backend commits salt hash BEFORE player bets
     * @dev This prevents player from manipulating the salt
     * @param player The player's address
     * @param saltHash Hash of backend's secret salt
     */
    function commitSaltHash(
        address player,
        bytes32 saltHash
    ) external onlyRelayer {
        require(player != address(0), "Invalid player");
        require(saltHash != bytes32(0), "Invalid salt hash");
        require(playerActiveGame[player] == 0, "Player has active game");

        // Allow overwriting pending salt (for retry scenarios)
        pendingSaltHash[player] = saltHash;
        emit SaltCommitted(player, saltHash);
    }

    /**
     * @notice Step 2: Player starts game with bet
     * @dev Salt must be committed first by backend
     * @param _gridSize Grid width (5, 6, or 7)
     */
    function startGame(
        uint8 _gridSize
    ) external payable nonReentrant {
        require(_isValidGridSize(_gridSize), "Grid must be 5, 6, or 7");
        require(playerActiveGame[msg.sender] == 0, "Active game exists");

        // Salt must be committed
        bytes32 saltHash = pendingSaltHash[msg.sender];
        require(saltHash != bytes32(0), "Salt not committed");

        // Clear pending salt
        delete pendingSaltHash[msg.sender];

        uint128 entropyFee = entropy.getFeeV2();
        require(msg.value > entropyFee, "Must include entropy fee + bet");

        uint256 betAmount = msg.value - entropyFee;
        require(betAmount >= minBet, "Bet too small");
        require(betAmount <= maxBet, "Bet too large");

        uint256 maxPotentialPayout = betAmount * 10;
        require(address(this).balance >= maxPotentialPayout, "Insufficient liquidity");

        uint64 sequenceNumber = entropy.requestV2{value: entropyFee}(entropyProvider, 150000);

        gameCounter++;
        uint64 gameId = gameCounter;

        games[gameId] = Game({
            player: msg.sender,
            betAmount: betAmount,
            revealedCount: 0,
            collectedReward: 0,
            vrfCommitment: bytes32(0),
            pythSeed: bytes32(0),
            backendSaltHash: saltHash,
            phase: GamePhase.WaitingVRF,
            won: false,
            payout: 0,
            timestamp: block.timestamp
        });

        vrfSeqToGame[sequenceNumber] = gameId;
        playerActiveGame[msg.sender] = gameId;
        gameGridSize[gameId] = _gridSize;

        totalGamesPlayed++;
        totalVolume += betAmount;

        emit GameStarted(gameId, msg.sender, betAmount, sequenceNumber, _gridSize);
    }

    /**
     * @notice Step 3: Backend sets start/finish tiles after VRF
     * @dev Called by backend after VRF received, before first move
     */
    function setGameTiles(
        uint64 gameId,
        uint8 _startTile,
        uint8 _finishTile
    ) external onlyRelayer {
        Game storage game = games[gameId];
        require(game.phase == GamePhase.Active, "Game not active");
        require(startTile[gameId] == 0 && finishTile[gameId] == 0, "Tiles already set");

        uint8 gridWidth = gameGridSize[gameId];
        uint8 totalTiles = _getGridTotalTiles(gridWidth);

        // Validate start tile (bottom row)
        uint8 bottomRowStart = totalTiles - gridWidth;
        require(_startTile >= bottomRowStart && _startTile < totalTiles, "Invalid start tile");

        // Validate finish tile (top row)
        require(_finishTile < gridWidth, "Invalid finish tile");

        startTile[gameId] = _startTile;
        finishTile[gameId] = _finishTile;
        foxPosition[gameId] = _startTile;

        // Auto-reveal start tile
        revealedTiles[gameId] |= (uint256(1) << _startTile);

        emit GameReady(gameId, _startTile, _finishTile, gridWidth);
    }

    /**
     * @notice Reveal a tile (relayer only)
     * @dev Backend knows tile types from finalSeed, sends them here
     *      All reveals are verified at game end in completeGame()
     */
    function revealTile(
        address player,
        uint64 gameId,
        uint8 tileIndex,
        uint8 tileType,
        uint256 reward
    ) external nonReentrant onlyRelayer {
        Game storage game = games[gameId];
        require(game.player == player, "Not player's game");
        require(game.phase == GamePhase.Active, "Game not active");

        uint8 gridWidth = gameGridSize[gameId];
        uint8 totalTiles = _getGridTotalTiles(gridWidth);

        require(tileIndex < totalTiles, "Invalid tile");
        require(!_isTileRevealed(gameId, tileIndex), "Already revealed");
        require(tileType <= 2, "Invalid tile type");

        // Must be adjacent to current position
        require(_isAdjacent4Way(foxPosition[gameId], tileIndex, gridWidth), "Not adjacent");

        // Cannot move backward (to lower row)
        uint8 currentRow = foxPosition[gameId] / gridWidth;
        uint8 newRow = tileIndex / gridWidth;
        require(newRow <= currentRow, "Cannot move backward");

        // Record this reveal for verification at game end
        gameReveals[gameId].push(TileReveal({
            tileIndex: tileIndex,
            tileType: tileType,
            reward: reward
        }));

        // Update state
        revealedTiles[gameId] |= (uint256(1) << tileIndex);
        foxPosition[gameId] = tileIndex;
        game.revealedCount++;

        if (tileType == uint8(TileType.Bomb)) {
            // BOMB - mark for completion (don't finalize yet, wait for completeGame)
            hitBombAt[gameId] = tileIndex + 1;
            emit TileRevealed(gameId, player, tileIndex, tileType, 0, 0, game.revealedCount);
            emit BombHit(gameId, player, tileIndex, game.betAmount);

        } else if (tileIndex == finishTile[gameId]) {
            // FINISH - mark for completion
            emit TileRevealed(gameId, player, tileIndex, uint8(TileType.Empty), 0, game.collectedReward, game.revealedCount);

        } else if (tileType == uint8(TileType.Reward)) {
            // REWARD
            game.collectedReward += reward;
            emit TileRevealed(gameId, player, tileIndex, tileType, reward, game.collectedReward, game.revealedCount);

        } else {
            // EMPTY
            emit TileRevealed(gameId, player, tileIndex, tileType, 0, game.collectedReward, game.revealedCount);
        }
    }

    /**
     * @notice Complete game with full verification
     * @dev Backend reveals salt, contract verifies EVERYTHING:
     *      1. Salt matches committed hash
     *      2. Recalculates map from finalSeed
     *      3. Verifies all revealed tiles match calculated types
     *      4. Processes payout
     *
     * @param gameId The game ID
     * @param backendSalt The backend's secret salt (revealed now!)
     * @param nonce The nonce used to find valid map
     */
    function completeGame(
        uint64 gameId,
        bytes32 backendSalt,
        uint8 nonce
    ) external nonReentrant onlyRelayer {
        Game storage game = games[gameId];
        require(game.phase == GamePhase.Active, "Game not active");

        // Game must be in terminal state (bomb hit or finish reached)
        bool hitBomb = hitBombAt[gameId] > 0;
        bool reachedFinish = foxPosition[gameId] == finishTile[gameId];
        require(hitBomb || reachedFinish, "Game not finished");

        uint8 gridWidth = gameGridSize[gameId];

        // === VERIFY SALT ===
        bytes32 expectedSaltHash = keccak256(abi.encodePacked(backendSalt));
        require(game.backendSaltHash == expectedSaltHash, "Invalid salt");

        // === CALCULATE FINAL SEED ===
        bytes32 finalSeed = keccak256(abi.encodePacked(
            game.pythSeed,
            backendSalt,
            gameId,
            VERSION
        ));

        // === VERIFY START TILE ===
        uint8 totalTiles = _getGridTotalTiles(gridWidth);
        uint8 bottomRowStart = totalTiles - gridWidth;
        bytes32 startHash = keccak256(abi.encodePacked(finalSeed, gameId, "start", VERSION));
        uint8 expectedStart = bottomRowStart + uint8(uint256(startHash) % gridWidth);
        require(startTile[gameId] == expectedStart, "Start tile mismatch");

        // === VERIFY FINISH TILE ===
        bytes32 finishHash = keccak256(abi.encodePacked(finalSeed, gameId, "finish", VERSION));
        uint8 expectedFinish = uint8(uint256(finishHash) % gridWidth);
        require(finishTile[gameId] == expectedFinish, "Finish tile mismatch");

        // === CALCULATE BOMB BITMAP ===
        uint64 calculatedBombs = _calculateBombs(
            finalSeed,
            gameId,
            startTile[gameId],
            finishTile[gameId],
            gridWidth,
            _getBombCount(gridWidth),
            nonce
        );

        // === VERIFY ALL REVEALED TILES ===
        TileReveal[] storage reveals = gameReveals[gameId];
        for (uint256 i = 0; i < reveals.length; i++) {
            TileReveal storage reveal = reveals[i];

            // Calculate expected tile type
            bool isBomb = (calculatedBombs & (uint64(1) << reveal.tileIndex)) != 0;

            if (isBomb) {
                require(reveal.tileType == uint8(TileType.Bomb), "Tile should be bomb");
            } else if (reveal.tileType == uint8(TileType.Bomb)) {
                revert("Tile is not a bomb");
            }

            // If reward tile, verify reward amount
            if (reveal.tileType == uint8(TileType.Reward)) {
                uint256 expectedReward = _calculateReward(finalSeed, gameId, reveal.tileIndex, game.betAmount);
                require(reveal.reward == expectedReward, "Reward mismatch");
            }
        }

        // === FINALIZE GAME ===
        // Store bomb bitmap for on-chain verification (uses slot 22, maintains upgrade compatibility)
        bombBitmap[gameId] = calculatedBombs;

        game.phase = GamePhase.Completed;
        playerActiveGame[game.player] = 0;

        if (hitBomb) {
            // Player lost
            game.won = false;
            game.payout = 0;
            game.collectedReward = 0;
            totalLosses++;

            emit GameCompleted(gameId, game.player, false, 0, game.revealedCount, finalSeed);
        } else {
            // Player won (reached finish)
            uint256 grossPayout = game.collectedReward;
            uint256 houseFee = (grossPayout * FEE_PERCENT) / PRECISION;
            uint256 netPayout = grossPayout - houseFee;

            game.won = true;
            game.payout = netPayout;
            totalWins++;
            totalPayout += netPayout;

            if (netPayout > 0) {
                (bool success,) = payable(game.player).call{value: netPayout}("");
                require(success, "Payout failed");
            }

            if (houseFee > 0 && feeRecipient != address(0)) {
                (bool feeSuccess,) = payable(feeRecipient).call{value: houseFee}("");
                require(feeSuccess, "Fee transfer failed");
            }

            emit FinishReached(gameId, game.player, netPayout, game.revealedCount);
            emit GameCompleted(gameId, game.player, true, netPayout, game.revealedCount, finalSeed);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL CALCULATION FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Calculate bomb positions deterministically (must match backend)
     * @dev Fisher-Yates shuffle with nonce for path guarantee
     */
    function _calculateBombs(
        bytes32 finalSeed,
        uint64 gameId,
        uint8 _startTile,
        uint8 _finishTile,
        uint8 gridWidth,
        uint8 bombCount,
        uint8 nonce
    ) internal pure returns (uint64) {
        uint8 totalTiles = gridWidth * gridWidth;

        // Build array of available tiles (exclude start and finish)
        uint8[] memory available = new uint8[](totalTiles - 2);
        uint8 idx = 0;
        for (uint8 i = 0; i < totalTiles; i++) {
            if (i != _startTile && i != _finishTile) {
                available[idx++] = i;
            }
        }

        // Fisher-Yates shuffle to select bomb positions
        uint64 bitmap = 0;
        for (uint8 i = 0; i < bombCount; i++) {
            bytes32 hash = keccak256(abi.encodePacked(
                finalSeed,
                gameId,
                "bomb",
                nonce,
                i,
                VERSION
            ));
            uint8 remaining = uint8(available.length - i);
            uint8 j = i + uint8(uint256(hash) % remaining);

            // Swap
            (available[i], available[j]) = (available[j], available[i]);

            // Add to bitmap
            bitmap |= (uint64(1) << available[i]);
        }

        return bitmap;
    }

    /**
     * @notice Calculate reward amount for a tile
     */
    function _calculateReward(
        bytes32 finalSeed,
        uint64 gameId,
        uint8 tileIndex,
        uint256 betAmount
    ) internal view returns (uint256) {
        bytes32 hash = keccak256(abi.encodePacked(
            finalSeed,
            gameId,
            "reward",
            tileIndex,
            VERSION
        ));
        uint256 roll = uint256(hash) % 10000;

        for (uint8 i = 0; i < 7; i++) {
            if (roll < TIER_THRESHOLDS[i]) {
                return (betAmount * REWARD_TIERS[i]) / 10000;
            }
        }
        return (betAmount * REWARD_TIERS[6]) / 10000;
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════

    function _isTileRevealed(uint64 gameId, uint8 tileIndex) internal view returns (bool) {
        return (revealedTiles[gameId] & (uint256(1) << tileIndex)) != 0;
    }

    function _isAdjacent4Way(uint8 from, uint8 to, uint8 gridWidth) internal pure returns (bool) {
        uint8 totalTiles = gridWidth * gridWidth;
        if (from >= totalTiles || to >= totalTiles) return false;

        uint8 fromX = from % gridWidth;
        uint8 fromY = from / gridWidth;
        uint8 toX = to % gridWidth;
        uint8 toY = to / gridWidth;

        int8 dx = int8(toX) - int8(fromX);
        int8 dy = int8(toY) - int8(fromY);

        return (dx == 0 && (dy == 1 || dy == -1)) ||
               (dy == 0 && (dx == 1 || dx == -1));
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function getGame(uint64 gameId) external view returns (Game memory) {
        return games[gameId];
    }

    function getActiveGame(address player) external view returns (uint64) {
        return playerActiveGame[player];
    }

    function getPendingSaltHash(address player) external view returns (bytes32) {
        return pendingSaltHash[player];
    }

    function getGameTiles(uint64 gameId) external view returns (
        uint8 _gridSize,
        uint8 _startTile,
        uint8 _finishTile,
        uint8 _foxPosition,
        uint256 _revealedTiles
    ) {
        return (
            gameGridSize[gameId],
            startTile[gameId],
            finishTile[gameId],
            foxPosition[gameId],
            revealedTiles[gameId]
        );
    }

    function getEntropyFee() external view returns (uint128) {
        return entropy.getFeeV2();
    }

    function isTileRevealed(uint64 gameId, uint8 tileIndex) external view returns (bool) {
        return _isTileRevealed(gameId, tileIndex);
    }

    function getRewardTiers() external view returns (uint32[7] memory tiers, uint16[7] memory thresholds) {
        return (REWARD_TIERS, TIER_THRESHOLDS);
    }

    function getStatistics() external view returns (
        uint256 gamesPlayed,
        uint256 wins,
        uint256 losses,
        uint256 payoutTotal,
        uint256 volumeTotal,
        uint256 balance
    ) {
        return (totalGamesPlayed, totalWins, totalLosses, totalPayout, totalVolume, address(this).balance);
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getBombCountForGrid(uint8 gridWidth) external pure returns (uint8) {
        return _getBombCount(gridWidth);
    }

    function getGameRevealsCount(uint64 gameId) external view returns (uint256) {
        return gameReveals[gameId].length;
    }

    // ═══════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    function setRelayer(address _newRelayer) external onlyOwner {
        require(_newRelayer != address(0), "Invalid address");
        address old = relayer;
        relayer = _newRelayer;
        emit RelayerUpdated(old, _newRelayer);
    }

    function setEntropy(address _newEntropy) external onlyOwner {
        require(_newEntropy != address(0), "Invalid address");
        entropy = IEntropyV2(_newEntropy);
    }

    function setEntropyProvider(address _newProvider) external onlyOwner {
        require(_newProvider != address(0), "Invalid address");
        entropyProvider = _newProvider;
    }

    function setFeeRecipient(address _newRecipient) external onlyOwner {
        address old = feeRecipient;
        feeRecipient = _newRecipient;
        emit FeeRecipientUpdated(old, _newRecipient);
    }

    function setBetLimits(uint256 _minBet, uint256 _maxBet) external onlyOwner {
        require(_minBet > 0 && _maxBet > _minBet, "Invalid limits");
        minBet = _minBet;
        maxBet = _maxBet;
        emit BetLimitsUpdated(_minBet, _maxBet);
    }

    function setRewardTiers(uint32[7] calldata _tiers, uint16[7] calldata _thresholds) external onlyOwner {
        require(_thresholds[6] == 10000, "Last must be 10000");
        REWARD_TIERS = _tiers;
        TIER_THRESHOLDS = _thresholds;
    }

    function cancelPendingSalt(address player) external onlyRelayer {
        delete pendingSaltHash[player];
    }

    function cancelGame(uint64 gameId) external nonReentrant {
        Game storage game = games[gameId];
        require(game.player != address(0), "Not found");
        require(game.phase != GamePhase.Completed, "Already completed");

        bool isAdmin = (msg.sender == owner() || msg.sender == relayer);
        bool isPlayerTimeout = (msg.sender == game.player && block.timestamp > game.timestamp + 1 hours);
        require(isAdmin || isPlayerTimeout, "Not authorized");

        address player = game.player;
        uint256 betAmount = game.betAmount;

        playerActiveGame[player] = 0;
        game.phase = GamePhase.Completed;
        game.won = false;
        game.payout = betAmount;

        if (betAmount > 0) {
            (bool success,) = payable(player).call{value: betAmount}("");
            require(success, "Refund failed");
        }

        emit GameCompleted(gameId, player, false, betAmount, game.revealedCount, bytes32(0));
    }

    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0 && address(this).balance >= amount, "Invalid amount");
        (bool success,) = payable(owner()).call{value: amount}("");
        require(success, "Transfer failed");
        emit Withdrawal(owner(), amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    receive() external payable {}
}
