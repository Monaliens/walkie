'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useWallet } from '@/hooks/useWallet'
import { PixelSelect } from './PixelSelect'

// Sprite images to preload
const SPRITE_IMAGES = [
  '/assets/sprites/king/King_Idle.png',
  '/assets/sprites/king/King_Walk.png',
  '/assets/sprites/king/King_Death.png',
  '/assets/sprites/king/tile_unrevealed.png',
  '/assets/sprites/king/tile_safe.png',
  '/assets/sprites/king/tile_treasure.png',
  '/assets/sprites/king/tile_trap.png',
]

// Sound effects - preload on init
const SOUNDS: Record<string, HTMLAudioElement | null> = {}

if (typeof window !== 'undefined') {
  const soundFiles = {
    start: '/assets/sounds/start.mp3',
    walk: '/assets/sounds/walk.mp3',
    safePrize: '/assets/sounds/safe-prize.mp3',
    win: '/assets/sounds/win.mp3',
    gameOver: '/assets/sounds/game-over.mp3',
  }
  Object.entries(soundFiles).forEach(([key, src]) => {
    const audio = new Audio(src)
    audio.preload = 'auto'
    audio.load()
    SOUNDS[key] = audio
  })
}

const playSound = (sound: string) => {
  const audio = SOUNDS[sound]
  if (audio) {
    audio.currentTime = 0
    audio.volume = 0.5
    audio.play().catch(() => {})
  }
}
import { useSession } from '@/hooks/useSession'
import { api, connectWebSocket, subscribeToGame, unsubscribeFromGame, setSessionToken, setRecentGameCallback } from '@/hooks/useApi'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, formatEther } from 'viem'

// Declare appkit-button
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { size?: string; balance?: string }, HTMLElement>
    }
  }
}

// Contract config - Testnet
const CONTRACT_ADDRESS = '0xB842b4B9d13bBcf5dDd2a47741e6D1610E34D497' as `0x${string}`

const CONTRACT_ABI = [
  {
    "inputs": [
      {"internalType": "uint8", "name": "_gridSize", "type": "uint8"}
    ],
    "name": "startGame",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      {"indexed": true, "internalType": "uint64", "name": "gameId", "type": "uint64"},
      {"indexed": true, "internalType": "address", "name": "player", "type": "address"},
      {"indexed": false, "internalType": "uint256", "name": "betAmount", "type": "uint256"},
      {"indexed": false, "internalType": "uint64", "name": "sequenceNumber", "type": "uint64"},
      {"indexed": false, "internalType": "uint8", "name": "gridSize", "type": "uint8"}
    ],
    "name": "GameStarted",
    "type": "event"
  }
] as const

// Grid config
const GRID_CONFIG: Record<number, { bombs: number; label: string }> = {
  5: { bombs: 3, label: '5x5' },
  6: { bombs: 5, label: '6x6' },
  7: { bombs: 7, label: '7x7' },
}

// Reward tiers
const REWARD_TIERS = [
  { label: '0.1x', chance: '35%', color: '#c0c0c0' },
  { label: '0.2x', chance: '25%', color: '#c0c0c0' },
  { label: '0.5x', chance: '20%', color: '#32cd32' },
  { label: '1x', chance: '12%', color: '#4169e1' },
  { label: '2x', chance: '5%', color: '#9932cc' },
  { label: '5x', chance: '2.5%', color: '#ffd700' },
  { label: '10x', chance: '0.5%', color: '#ffd700' },
]

type GamePhase = 'idle' | 'waiting_vrf' | 'active' | 'completed'
type FoxState = 'idle' | 'walking' | 'hurt' | 'death'
type FoxDirection = 'up' | 'down' | 'left' | 'right'

interface GameState {
  gameId: string | null
  phase: GamePhase
  gridSize: number
  betAmount: string
  startTile: number | null
  finishTile: number | null
  foxPosition: number | null
  foxDirection: FoxDirection
  foxState: FoxState
  revealedTiles: Set<number>
  bombPositions: Set<number>
  rewardTiles: Set<number>
  emptyTiles: Set<number>
  tileRewards: Map<number, bigint>
  missedRewards: Map<number, bigint>
  collectedReward: bigint
  revealedCount: number
  won: boolean
  payout: string
}

// Function to create fresh game state (avoids shared Set/Map references)
const createInitialGameState = (gridSize = 5, betAmount = '0.02'): GameState => ({
  gameId: null,
  phase: 'idle',
  gridSize,
  betAmount,
  startTile: null,
  finishTile: null,
  foxPosition: null,
  foxDirection: 'up',
  foxState: 'idle',
  revealedTiles: new Set(),
  bombPositions: new Set(),
  rewardTiles: new Set(),
  emptyTiles: new Set(),
  tileRewards: new Map(),
  missedRewards: new Map(),
  collectedReward: 0n,
  revealedCount: 0,
  won: false,
  payout: '0',
})

const initialGameState = createInitialGameState()

export function GamePage() {
  const { address, isConnected, isReady, balance, balanceSymbol, displayAddress } = useWallet()
  const { token, hasValidSession, isCreating: isCreatingSession, createSession } = useSession()

  // Game state
  const [game, setGame] = useState<GameState>(initialGameState)
  const [entropyFee, setEntropyFee] = useState('0.4')
  const [isRevealing, setIsRevealing] = useState(false)
  const [status, setStatus] = useState('Connect wallet to start')
  const [statusType, setStatusType] = useState<'success' | 'error' | 'warning' | ''>('')

  // History state
  const [historyTab, setHistoryTab] = useState<'my' | 'all'>('all')
  const [historyGames, setHistoryGames] = useState<any[]>([])
  const [historyPage, setHistoryPage] = useState(1)

  // Contract write
  const { writeContractAsync, isPending: isTxPending } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const { isLoading: isTxConfirming } = useWaitForTransactionReceipt({ hash: txHash })

  // Refs
  const gridRef = useRef<HTMLDivElement>(null)
  const wsCallbackRef = useRef<((data: any) => void) | null>(null)
  const resetTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isStartingGameRef = useRef<boolean>(false)
  const expectedGameIdRef = useRef<string | null>(null)

  // Show status message
  const showStatus = useCallback((message: string, type: 'success' | 'error' | 'warning' | '' = '') => {
    setStatus(message)
    setStatusType(type)
  }, [])

  // Set session token when it changes
  useEffect(() => {
    if (token) {
      setSessionToken(token)
    }
  }, [token])

  // Preload sprite images on mount (JavaScript Image constructor for cache)
  useEffect(() => {
    SPRITE_IMAGES.forEach((src) => {
      const img = new window.Image()
      img.src = src
    })
  }, [])

  // Connect WebSocket on mount
  useEffect(() => {
    connectWebSocket()
  }, [])

  // Update status when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      if (hasValidSession) {
        showStatus('Connected! Ready to play', 'success')
      } else {
        showStatus('Please sign in to play', 'warning')
      }
    } else {
      showStatus('Connect wallet to start', '')
    }
  }, [isConnected, address, hasValidSession, showStatus])

  // Fetch entropy fee
  useEffect(() => {
    const fetchFee = async () => {
      try {
        const response = await api.getEntropyFee()
        if (response.success) {
          const feeEth = Number(BigInt(response.fee)) / 1e18
          setEntropyFee(feeEth.toFixed(3))
        }
      } catch (e) {
        // Ignore
      }
    }
    fetchFee()
  }, [])

  // Load history
  const loadHistory = useCallback(async () => {
    try {
      let response
      const offset = (historyPage - 1) * 10
      if (historyTab === 'my' && address) {
        response = await api.getPlayerGames(address, 10, offset)
      } else {
        response = await api.getRecentGames(10, offset)
      }

      if (response.success) {
        setHistoryGames(response.games || [])
      }
    } catch (e) {
      // console.error('Failed to load history:', e)
    }
  }, [historyTab, historyPage, address])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // Live update history when new game completes
  useEffect(() => {
    if (historyPage === 1) {
      setRecentGameCallback(() => loadHistory())
      return () => setRecentGameCallback(null)
    }
  }, [historyPage, loadHistory])

  // Load existing game on connect
  useEffect(() => {
    const loadExistingGame = async () => {
      if (!address || !hasValidSession) return

      // Don't load if we're in the middle of starting a new game
      if (isStartingGameRef.current) return

      try {
        const response = await api.getActiveGame(address)

        // Double check we're not starting a game (in case of race condition)
        if (isStartingGameRef.current) return

        if (response.success && response.game) {
          const gameData = response.game

          const newRevealedTiles = new Set<number>(gameData.revealed_tiles || [])
          const newRewardTiles = new Set<number>()
          const newEmptyTiles = new Set<number>()
          const newTileRewards = new Map<number, bigint>()

          // Restore tile types from tile_data
          if (gameData.tile_data && gameData.tile_data.length > 0) {
            for (const tile of gameData.tile_data) {
              const idx = tile.tileIndex
              if (tile.isReward) {
                newRewardTiles.add(idx)
                newTileRewards.set(idx, BigInt(tile.reward || '0'))
              } else if (tile.isEmpty) {
                newEmptyTiles.add(idx)
              }
            }
          }

          // Start tile is always empty
          const startTile = gameData.start_tile
          if (startTile !== null && newRevealedTiles.has(startTile) && !newRewardTiles.has(startTile)) {
            newEmptyTiles.add(startTile)
          }

          // Fox position
          let foxPos = startTile
          if (gameData.fox_position !== undefined && gameData.fox_position !== null) {
            foxPos = gameData.fox_position
          } else if (gameData.revealed_tiles && gameData.revealed_tiles.length > 0) {
            foxPos = gameData.revealed_tiles[gameData.revealed_tiles.length - 1]
          }

          setGame({
            gameId: gameData.game_id,
            phase: gameData.phase as GamePhase,
            gridSize: gameData.grid_size || 5,
            betAmount: formatEther(BigInt(gameData.bet_amount)),
            startTile: gameData.start_tile,
            finishTile: gameData.finish_tile,
            foxPosition: foxPos,
            foxDirection: 'up',
            foxState: 'idle',
            revealedTiles: newRevealedTiles,
            bombPositions: new Set(),
            rewardTiles: newRewardTiles,
            emptyTiles: newEmptyTiles,
            tileRewards: newTileRewards,
            missedRewards: new Map(),
            collectedReward: BigInt(gameData.collected_reward || '0'),
            revealedCount: gameData.revealed_count || 0,
            won: false,
            payout: '0',
          })

          if (gameData.phase === 'active') {
            showStatus('Path resumed! Find the exit!', 'success')
            // Subscribe to game events
            subscribeToGame(gameData.game_id, handleGameEvent)
          }
        }
      } catch (error) {
        // console.error('Failed to load existing game:', error)
      }
    }

    loadExistingGame()
  }, [address, hasValidSession])

  // Handle WebSocket game events
  const handleGameEvent = useCallback((message: any) => {
    // Production: log removed

    switch (message.type) {
      case 'vrfReceived':
        onVRFReceived(message)
        break
      case 'finishReached':
        onFinishReached(message)
        break
      case 'gameCompleted':
        onGameCompleted(message)
        break
    }
  }, [])

  // Store callback ref for WebSocket
  useEffect(() => {
    wsCallbackRef.current = handleGameEvent
  }, [handleGameEvent])

  // VRF received - game is now active
  const onVRFReceived = useCallback((data: any) => {
    setGame(prev => {
      const gridSize = data.gridSize ?? prev.gridSize
      const startTile = data.startTile ?? prev.startTile
      const finishTile = data.finishTile ?? prev.finishTile

      const newRevealedTiles = new Set<number>()
      if (startTile !== null) newRevealedTiles.add(startTile)

      const newEmptyTiles = new Set<number>()
      if (startTile !== null) newEmptyTiles.add(startTile)

      return {
        ...prev,
        phase: 'active',
        gridSize,
        startTile,
        finishTile,
        foxPosition: startTile,
        foxState: 'idle',
        revealedTiles: newRevealedTiles,
        emptyTiles: newEmptyTiles,
        revealedCount: 1,
      }
    })
    showStatus('Find the exit! Collect treasure on the way!', 'success')
    playSound('start')
  }, [showStatus])

  // Finish reached - auto win
  const onFinishReached = useCallback((data: any) => {
    setGame(prev => {
      const newMissedRewards = new Map(prev.missedRewards)
      if (data.missedRewards) {
        data.missedRewards.forEach((r: any) => {
          newMissedRewards.set(r.index, BigInt(r.reward))
        })
      }

      return {
        ...prev,
        phase: 'completed',
        won: true,
        payout: data.payout,
        missedRewards: newMissedRewards,
      }
    })

    const payoutMON = parseFloat(formatEther(BigInt(data.payout)))
    showStatus(`Escaped with ${payoutMON.toFixed(4)} MON!`, 'success')
    playSound('win')

    setTimeout(() => {
      showGameOver(true)
    }, 1500)
  }, [showStatus])

  // Game completed (from WebSocket)
  const onGameCompleted = useCallback((data: any) => {
    const { won, payout, bombPositions, missedRewards } = data

    setGame(prev => {
      const newBombPositions = new Set(prev.bombPositions)
      if (bombPositions) {
        bombPositions.forEach((pos: number) => newBombPositions.add(pos))
      }

      const newMissedRewards = new Map(prev.missedRewards)
      if (missedRewards) {
        missedRewards.forEach((r: any) => {
          if (!prev.revealedTiles.has(r.index)) {
            newMissedRewards.set(r.index, BigInt(r.reward))
          }
        })
      }

      if (prev.gameId) {
        unsubscribeFromGame(prev.gameId)
      }

      return {
        ...prev,
        phase: 'completed',
        won,
        payout,
        bombPositions: newBombPositions,
        missedRewards: newMissedRewards,
      }
    })

    // Animate reveal
    setTimeout(() => animateReveal(), 50)

    // Show game over after animations
    setTimeout(() => {
      showGameOver(won)
    }, won ? 400 : 800)
  }, [])

  // Animate tile reveal
  const animateReveal = useCallback(() => {
    if (!gridRef.current) return
    const cells = gridRef.current.querySelectorAll('.cell.trap-reveal, .cell.reward-missed, .cell.finish-reveal, .cell.faded')
    cells.forEach(cell => {
      const delay = Math.random() * 200
      ;(cell as HTMLElement).style.opacity = '0'
      ;(cell as HTMLElement).style.animationDelay = `${delay}ms`
      cell.classList.add('reveal-pop')
    })
  }, [])

  // Show game over
  const showGameOver = useCallback((won: boolean) => {
    if (won) {
      setGame(prev => {
        const payoutMON = parseFloat(formatEther(BigInt(prev.payout)))
        showStatus(`Victory! +${payoutMON.toFixed(4)} MON`, 'success')
        playSound('win')
        return prev
      })
    } else {
      showStatus('The king got trapped! Try again?', 'error')
    }

    // Reset to idle after delay (clear any existing timeout first)
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current)
    }
    resetTimeoutRef.current = setTimeout(() => {
      setGame(prev => createInitialGameState(prev.gridSize, prev.betAmount))
      resetTimeoutRef.current = null
    }, 2000)
  }, [showStatus])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (game.phase !== 'active' || isRevealing || game.foxPosition === null) return

      const keyMoves: Record<string, { dx: number; dy: number; dir: FoxDirection }> = {
        'ArrowUp': { dx: 0, dy: -1, dir: 'up' },
        'ArrowLeft': { dx: -1, dy: 0, dir: 'left' },
        'ArrowRight': { dx: 1, dy: 0, dir: 'right' },
        'w': { dx: 0, dy: -1, dir: 'up' },
        'W': { dx: 0, dy: -1, dir: 'up' },
        'a': { dx: -1, dy: 0, dir: 'left' },
        'A': { dx: -1, dy: 0, dir: 'left' },
        'd': { dx: 1, dy: 0, dir: 'right' },
        'D': { dx: 1, dy: 0, dir: 'right' },
      }

      const move = keyMoves[e.key]
      if (move) {
        e.preventDefault()
        const gridWidth = game.gridSize
        const currentX = game.foxPosition! % gridWidth
        const currentY = Math.floor(game.foxPosition! / gridWidth)
        const newX = currentX + move.dx
        const newY = currentY + move.dy

        if (newX >= 0 && newX < gridWidth && newY >= 0 && newY < gridWidth) {
          const newIndex = newY * gridWidth + newX
          moveFoxTo(newIndex, move.dir)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [game.phase, game.foxPosition, game.gridSize, isRevealing])

  // Check if move is valid
  const isValidMove = useCallback((tileIndex: number) => {
    if (game.foxPosition === null) return false

    const gridWidth = game.gridSize
    const foxX = game.foxPosition % gridWidth
    const foxY = Math.floor(game.foxPosition / gridWidth)
    const tileX = tileIndex % gridWidth
    const tileY = Math.floor(tileIndex / gridWidth)

    // Must be adjacent
    const dx = Math.abs(foxX - tileX)
    const dy = Math.abs(foxY - tileY)
    if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1))) return false

    // Cannot go to revealed tile
    if (game.revealedTiles.has(tileIndex)) return false

    // Cannot go backward (to lower row)
    if (tileY > foxY) return false

    return true
  }, [game.foxPosition, game.gridSize, game.revealedTiles])

  // Get valid moves from current position
  const getValidMoves = useCallback(() => {
    if (game.foxPosition === null) return []

    const gridWidth = game.gridSize
    const foxX = game.foxPosition % gridWidth
    const foxY = Math.floor(game.foxPosition / gridWidth)

    const directions = [
      [0, -1],  // up
      [-1, 0],  // left
      [1, 0],   // right
    ]

    const validMoves: number[] = []
    for (const [dx, dy] of directions) {
      const newX = foxX + dx
      const newY = foxY + dy
      if (newX >= 0 && newX < gridWidth && newY >= 0 && newY < gridWidth) {
        const newIndex = newY * gridWidth + newX
        if (!game.revealedTiles.has(newIndex)) {
          validMoves.push(newIndex)
        }
      }
    }

    return validMoves
  }, [game.foxPosition, game.gridSize, game.revealedTiles])

  // Move fox to tile
  const moveFoxTo = useCallback(async (tileIndex: number, direction?: FoxDirection) => {
    if (!isValidMove(tileIndex) || isRevealing || !game.gameId) return

    setIsRevealing(true)

    // Update direction
    if (direction) {
      setGame(prev => ({ ...prev, foxDirection: direction, foxState: 'walking' }))
    } else {
      setGame(prev => {
        const gridWidth = prev.gridSize
        const dx = (tileIndex % gridWidth) - (prev.foxPosition! % gridWidth)
        const dy = Math.floor(tileIndex / gridWidth) - Math.floor(prev.foxPosition! / gridWidth)
        let newDir: FoxDirection = 'up'
        if (Math.abs(dx) > Math.abs(dy)) {
          newDir = dx > 0 ? 'right' : 'left'
        } else {
          newDir = dy > 0 ? 'down' : 'up'
        }
        return { ...prev, foxDirection: newDir, foxState: 'walking' }
      })
    }

    try {
      const response = await api.revealTile(game.gameId, tileIndex)

      if (!response.success) {
        throw new Error(response.error || 'Reveal failed')
      }

      setGame(prev => {
        const newRevealedTiles = new Set(prev.revealedTiles)
        newRevealedTiles.add(tileIndex)

        if (response.isBomb) {
          // TRAP HIT!
          const newBombPositions = new Set(prev.bombPositions)
          newBombPositions.add(tileIndex)

          return {
            ...prev,
            foxPosition: tileIndex,
            foxState: 'hurt',
            revealedTiles: newRevealedTiles,
            bombPositions: newBombPositions,
            revealedCount: prev.revealedCount + 1,
          }
        } else if (response.finishReached) {
          // FINISH - Auto win handled by WebSocket
          const newEmptyTiles = new Set(prev.emptyTiles)
          newEmptyTiles.add(tileIndex)

          return {
            ...prev,
            foxPosition: tileIndex,
            foxState: 'idle',
            revealedTiles: newRevealedTiles,
            emptyTiles: newEmptyTiles,
            revealedCount: prev.revealedCount + 1,
          }
        } else if (response.isReward) {
          // TREASURE!
          const reward = BigInt(response.reward)
          const newRewardTiles = new Set(prev.rewardTiles)
          newRewardTiles.add(tileIndex)
          const newTileRewards = new Map(prev.tileRewards)
          newTileRewards.set(tileIndex, reward)

          const rewardMON = parseFloat(formatEther(reward))
          showStatus(`Found ${rewardMON.toFixed(4)} MON treasure!`, 'success')
          playSound('safePrize')

          return {
            ...prev,
            foxPosition: tileIndex,
            foxState: 'idle',
            revealedTiles: newRevealedTiles,
            rewardTiles: newRewardTiles,
            tileRewards: newTileRewards,
            collectedReward: prev.collectedReward + reward,
            revealedCount: prev.revealedCount + 1,
          }
        } else {
          // EMPTY - safe grass
          const newEmptyTiles = new Set(prev.emptyTiles)
          newEmptyTiles.add(tileIndex)
          showStatus('Safe path! Keep going...', '')
          playSound('walk')

          return {
            ...prev,
            foxPosition: tileIndex,
            foxState: 'idle',
            revealedTiles: newRevealedTiles,
            emptyTiles: newEmptyTiles,
            revealedCount: prev.revealedCount + 1,
          }
        }
      })

      if (response.isBomb) {
        showStatus('The king stepped on a trap!', 'error')
        playSound('gameOver')
        setTimeout(() => {
          setGame(prev => ({ ...prev, foxState: 'death' }))
        }, 400)
      }

    } catch (error: any) {
      // console.error('Reveal error:', error)
      showStatus(error.message, 'error')
      setGame(prev => ({ ...prev, foxState: 'idle' }))
    } finally {
      setIsRevealing(false)
    }
  }, [game.gameId, isValidMove, isRevealing, showStatus])

  // Handle session creation
  const handleSignIn = async () => {
    const success = await createSession()
    if (success) {
      showStatus('Signed in! Ready to play', 'success')
    }
  }

  // Start game
  const handleStartGame = async () => {
    // Mark that we're starting a new game - prevents loadExistingGame from interfering
    isStartingGameRef.current = true

    // Clear any pending reset timeout from previous game
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = null
    }

    // Immediately reset state to prevent showing old game data
    setGame(prev => createInitialGameState(prev.gridSize, prev.betAmount))

    if (!isConnected || !address) {
      showStatus('Connect wallet first!', 'error')
      isStartingGameRef.current = false
      return
    }

    if (!hasValidSession) {
      showStatus('Please sign in first!', 'error')
      isStartingGameRef.current = false
      return
    }

    try {
      // Validate bet amount
      const betNum = parseFloat(game.betAmount)
      if (isNaN(betNum) || betNum < 0.01) {
        showStatus('Min bet: 0.01 MON', 'error')
        isStartingGameRef.current = false
        return
      }
      if (betNum > 1) {
        showStatus('Max bet: 1 MON', 'error')
        isStartingGameRef.current = false
        return
      }

      showStatus('Preparing path...', 'warning')


      const prepareResponse = await api.prepareGame(game.gridSize)
      if (!prepareResponse.success) {
        throw new Error(prepareResponse.error || 'Failed to prepare')
      }

      
      if (!prepareResponse.ready) {
        throw new Error('Salt not committed on-chain')
      }

      // Calculate total value
      const betWei = parseEther(game.betAmount)
      const feeWei = parseEther(entropyFee)
      const totalValue = betWei + feeWei

      showStatus('Confirm transaction...', 'warning')

      
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'startGame',
        args: [game.gridSize],
        value: totalValue,
      })

      setTxHash(hash)
      showStatus('Transaction sent...', 'warning')

      // Wait for transaction and parse events
      // The gameId will come from WebSocket vrfReceived event
      // For now, use backend to get game ID after tx confirms

      // Poll for active game
      let attempts = 0
      const maxAttempts = 30
      const pollInterval = setInterval(async () => {
        attempts++
        try {
          const activeGame = await api.getActiveGame(address)
          if (activeGame.success && activeGame.game && activeGame.game.phase === 'waiting_vrf') {
            clearInterval(pollInterval)

            const gameId = activeGame.game.game_id

            
            setGame(prev => ({
              ...prev,
              gameId,
              phase: 'waiting_vrf',
              startTile: null,
              finishTile: null,
              foxPosition: null,
              revealedTiles: new Set(),
              bombPositions: new Set(),
              rewardTiles: new Set(),
              emptyTiles: new Set(),
              tileRewards: new Map(),
              missedRewards: new Map(),
              collectedReward: 0n,
              revealedCount: 0,
              won: false,
              payout: '0',
            }))

            // Subscribe to game events
            subscribeToGame(gameId, handleGameEvent)
            showStatus('Waiting for VRF...', 'warning')

            // Game setup complete, allow loadExistingGame again
            isStartingGameRef.current = false
          }
        } catch (e) {
          // Keep polling
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval)
          isStartingGameRef.current = false
          showStatus('Game started! Waiting for confirmation...', 'warning')
        }
      }, 1000)

    } catch (error: any) {
      // console.error('Start game error:', error)
      showStatus(error.message || 'Failed to start game', 'error')
      isStartingGameRef.current = false
    }
  }

  // Handle tile click
  const handleTileClick = (index: number) => {
    if (game.phase !== 'active' || isRevealing) return
    if (!isValidMove(index)) {
      if (!game.revealedTiles.has(index)) {
        showStatus('Move to adjacent tiles only!', 'warning')
      }
      return
    }
    moveFoxTo(index)
  }

  // Get start/finish tile indices
  const getStartTiles = (size: number) => Array.from({ length: size }, (_, i) => size * (size - 1) + i)
  const getFinishTiles = (size: number) => Array.from({ length: size }, (_, i) => i)

  // Get tile class
  const getTileClass = (index: number) => {
    const classes = ['cell']
    const validMoves = game.phase === 'active' ? getValidMoves() : []
    const startTiles = getStartTiles(game.gridSize)
    const finishTiles = getFinishTiles(game.gridSize)

    if (game.phase === 'idle') {
      classes.push('idle')
      if (startTiles.includes(index)) classes.push('start-area')
      if (finishTiles.includes(index)) classes.push('finish-area')

    } else if (game.revealedTiles.has(index)) {
      if (game.bombPositions.has(index)) {
        classes.push('trap')
      } else if (game.rewardTiles.has(index)) {
        classes.push('reward', 'grass')
        const reward = game.tileRewards.get(index)
        if (reward) {
          classes.push(getRewardClass(reward))
        }
      } else {
        classes.push('grass', 'visited')
        if (index === game.startTile) classes.push('start-tile')
        if (index === game.finishTile) classes.push('finish-tile')
      }

    } else if (game.phase === 'completed') {
      if (game.bombPositions.has(index)) {
        classes.push('trap-reveal')
      } else if (game.missedRewards.has(index)) {
        classes.push('reward-missed')
      } else if (index === game.finishTile) {
        classes.push('finish-reveal')
      } else {
        classes.push('bush', 'faded')
      }

    } else {
      classes.push('bush')
      if (validMoves.includes(index)) {
        classes.push('adjacent')
      }
      if (index === game.finishTile) {
        classes.push('finish-marker')
      }
    }

    return classes.join(' ')
  }

  // Get reward tier class
  const getRewardClass = (reward: bigint) => {
    try {
      const betAmount = parseEther(game.betAmount)
      const ratio = (reward * 10000n) / betAmount
      const ratioNum = Number(ratio)

      if (ratioNum >= 50000) return 'reward-legendary'
      if (ratioNum >= 20000) return 'reward-epic'
      if (ratioNum >= 10000) return 'reward-rare'
      if (ratioNum >= 5000) return 'reward-uncommon'
      return 'reward-common'
    } catch {
      return 'reward-common'
    }
  }

  // Calculate fox position style
  const getFoxStyle = () => {
    if (game.foxPosition === null) return { display: 'none' }

    const gridWidth = game.gridSize
    const x = game.foxPosition % gridWidth
    const y = Math.floor(game.foxPosition / gridWidth)

    return {
      display: 'block',
      left: `calc(var(--grid-padding) + ${x} * (var(--cell-size) + var(--cell-gap)) + (var(--cell-size) - var(--fox-size)) / 2)`,
      top: `calc(var(--grid-padding) + ${y} * (var(--cell-size) + var(--cell-gap)) + (var(--cell-size) - var(--fox-size)) / 2)`,
    }
  }

  // Render grid
  const renderGrid = () => {
    const cells = []
    for (let i = 0; i < game.gridSize * game.gridSize; i++) {
      const isReward = game.rewardTiles.has(i) && game.revealedTiles.has(i)
      const isBomb = game.bombPositions.has(i) && (game.revealedTiles.has(i) || game.phase === 'completed')
      const isMissedReward = game.missedRewards.has(i) && game.phase === 'completed'
      const isFinish = i === game.finishTile && game.revealedTiles.has(i)
      const isFinishReveal = i === game.finishTile && game.phase === 'completed' && !game.revealedTiles.has(i)

      cells.push(
        <div
          key={i}
          className={getTileClass(i)}
          onClick={() => handleTileClick(i)}
        >
          {isReward && (
            <span className="reward-value">
              {Number(formatEther(game.tileRewards.get(i)!)).toFixed(2)}
            </span>
          )}
          {isMissedReward && (
            <span className="reward-value">
              {Number(formatEther(game.missedRewards.get(i)!)).toFixed(2)}
            </span>
          )}
        </div>
      )
    }
    return cells
  }

  const isGameActive = game.phase === 'active' || game.phase === 'waiting_vrf'

  return (
    <div className="app">
      {/* Hidden sprite preloader - loads all CSS background images */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div className="king idle dir-up" />
        <div className="king walking dir-up" />
        <div className="king death dir-up" />
        <div className="king hurt dir-up" />
        <div className="cell bush" />
        <div className="cell grass" />
        <div className="cell reward" />
        <div className="cell trap" />
      </div>

      {/* Header */}
      <header className="header">
        <div className="logo">
          <span className="logo-text">WALK<span className="accent">IE</span></span>
          <a href="https://monaliens.xyz" target="_blank" rel="noopener noreferrer" className="logo-subtitle">by Monaliens</a>
        </div>
        <div className="wallet-section">
          {isConnected && (
            <div className="balance-display" style={{ marginRight: '10px', fontFamily: 'var(--font-pixel)', fontSize: '10px', color: 'var(--text-gold)' }}>
              {parseFloat(balance).toFixed(2)} {balanceSymbol}
            </div>
          )}
          <appkit-button size="sm" balance="hide" />
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Left Panel */}
        <aside className="panel panel-left">
          {/* Setup Panel */}
          {!isGameActive && (
            <div className="panel-content">
              <h3 className="panel-title">Path Game</h3>

              {/* Sign In Button */}
              {isConnected && !hasValidSession && (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginBottom: '12px' }}
                  onClick={handleSignIn}
                  disabled={isCreatingSession}
                >
                  {isCreatingSession ? 'Signing...' : 'Sign In to Play'}
                </button>
              )}

              {/* Grid Size */}
              <div className="input-group">
                <label>Grid Size</label>
                <PixelSelect
                  options={[
                    { value: 5, label: '5x5 (3 Traps)' },
                    { value: 6, label: '6x6 (5 Traps)' },
                    { value: 7, label: '7x7 (7 Traps)' },
                  ]}
                  value={game.gridSize}
                  onChange={(value) => setGame(prev => ({ ...prev, gridSize: Number(value) }))}
                />
              </div>

              {/* Bet Amount */}
              <div className="input-group">
                <label>Bet Amount</label>
                <div className="input-suffix">
                  <input
                    type="number"
                    className="pixel-input"
                    value={game.betAmount}
                    onChange={(e) => setGame(prev => ({ ...prev, betAmount: e.target.value }))}
                    min="0.1"
                    max="10"
                    step="0.01"
                  />
                  <span className="suffix">MON</span>
                </div>
                <div className="quick-btns">
                  {['0.02', '0.03', '0.04', '0.05'].map((amt) => (
                    <button
                      key={amt}
                      className="btn-quick"
                      onClick={() => setGame(prev => ({ ...prev, betAmount: amt }))}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '6px', marginBottom: '-4px', textAlign: 'center' }}>
                  min 0.01 · max 1
                </div>
              </div>

              {/* Grid Info */}
              <div style={{ background: 'var(--earth-dark)', padding: '10px', marginBottom: '12px', border: '2px solid var(--earth-mid)' }}>
                <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: 'var(--text-gold)', marginBottom: '6px' }}>
                  GRID: {game.gridSize}x{game.gridSize}
                </div>
                <div style={{ fontSize: '12px' }}>
                  Traps: {GRID_CONFIG[game.gridSize]?.bombs || 5}
                </div>
              </div>

              <div className="game-info" style={{ background: 'var(--earth-dark)', padding: '10px', marginBottom: '12px', border: '2px solid var(--earth-mid)' }}>
                <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: 'var(--text-gold)', marginBottom: '6px' }}>GAME RULES</div>
                <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                  • Navigate from start to exit<br />
                  • Collect gold along the way<br />
                  • Avoid traps to win
                </div>
              </div>

              {/* Start Button */}
              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '10px' }}
                onClick={handleStartGame}
                disabled={!isConnected || !hasValidSession || isTxPending || isTxConfirming}
              >
                {isTxPending || isTxConfirming ? 'Starting...' : 'Start Path'}
              </button>

              <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '12px', opacity: 0.7 }}>
                VRF Fee: ~{entropyFee} MON
              </div>
            </div>
          )}

          {/* Active Game Panel */}
          {isGameActive && (
            <div className="panel-content">
              <h3 className="panel-title">Progress</h3>

              <div className="stats-grid">
                <div className="stat-box">
                  <div className="stat-label">Steps</div>
                  <div className="stat-value">{game.revealedCount}</div>
                </div>
                <div className="stat-box highlight">
                  <div className="stat-label">Treasure</div>
                  <div className="stat-value">{Number(formatEther(game.collectedReward)).toFixed(2)}</div>
                </div>
              </div>

              <button className="btn btn-success" style={{ width: '100%', marginTop: '10px' }} disabled>
                Reach Exit to Win
              </button>

              <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '11px', color: 'var(--text-gold)' }}>
                Find the exit at the top row!
              </div>
            </div>
          )}

          {/* Rewards Info */}
          <div className="panel-content">
            <h3 className="panel-title">Treasures</h3>
            <div style={{ fontSize: '12px' }}>
              {REWARD_TIERS.map((tier, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: tier.color }}>{tier.label}</span>
                  <span style={{ opacity: 0.7 }}>{tier.chance}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Center - Game Grid */}
        <section className="game-section">
          <div className="status-bar">
            <div className={`status-message ${statusType}`}>{status}</div>
          </div>
          <div className="grid-wrapper">
            <div
              key={`grid-${game.gameId || 'idle'}-${game.phase}`}
              ref={gridRef}
              className={`grid ${game.phase === 'completed' ? (game.won ? 'game-won' : 'game-lost') : ''}`}
              style={{ gridTemplateColumns: `repeat(${game.gridSize}, var(--cell-size))` }}
            >
              {renderGrid()}
            </div>
            {(game.phase === 'active' || game.phase === 'completed') && game.foxPosition !== null && (
              <div
                className={`king ${game.foxState} dir-${game.foxDirection}`}
                id="kingSprite"
                style={getFoxStyle()}
              />
            )}
          </div>
          <div className="controls-hint">
            <p>Use arrow keys or WAD to move (no going back!)</p>
            <div className="key-hints-3way">
              <div className="key">W</div>
              <div className="key-row">
                <div className="key">A</div>
                <div className="key">D</div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Panel */}
        <aside className="panel panel-right">
          <div className="panel-content">
            <h3 className="panel-title">How to Play</h3>
            <ol className="steps-list">
              <li>Set your bet amount</li>
              <li>Click Start Path</li>
              <li>Navigate from bottom to top</li>
              <li>Collect treasure, avoid traps!</li>
              <li>Reach exit to win</li>
            </ol>
          </div>

          <div className="panel-content">
            <h3 className="panel-title">Tile Types</h3>
            <div className="tile-legend">
              <div className="legend-item">
                <div className="legend-tile bush"></div>
                <div className="legend-info">
                  <span className="legend-name">Hidden</span>
                  <span className="legend-desc">Unknown tile</span>
                </div>
              </div>
              <div className="legend-item">
                <div className="legend-tile grass"></div>
                <div className="legend-info">
                  <span className="legend-name">Safe</span>
                  <span className="legend-desc">Clear path</span>
                </div>
              </div>
              <div className="legend-item">
                <div className="legend-tile reward"></div>
                <div className="legend-info">
                  <span className="legend-name">Gold</span>
                  <span className="legend-desc">Collect MON</span>
                </div>
              </div>
              <div className="legend-item">
                <div className="legend-tile trap"></div>
                <div className="legend-info">
                  <span className="legend-name">Trap</span>
                  <span className="legend-desc">Lose bet</span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel-content">
            <h3 className="panel-title">Contract</h3>
            <div style={{ fontSize: '10px', wordBreak: 'break-all' }}>
              <a
                href={`https://testnet.monadexplorer.com/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--gold)', textDecoration: 'none' }}
              >
                {CONTRACT_ADDRESS.slice(0, 6)}...{CONTRACT_ADDRESS.slice(-4)}
              </a>
            </div>
            <div style={{ fontSize: '9px', marginTop: '4px', opacity: 0.6 }}>
              On Monad Testnet · Powered by Pyth Entropy VRF
            </div>
            <Link
              href="/verify"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '10px', textAlign: 'center', textDecoration: 'none', display: 'block', fontSize: '12px', animation: 'pulse-glow 2s ease-in-out infinite' }}
            >
              Verify Fairness
            </Link>
          </div>
        </aside>
      </main>

      {/* Game History */}
      <section className="history-section">
        <div className="history-container">
          <div className="history-header">
            <h3 className="panel-title">Game History</h3>
            <div className="history-tabs">
              <button
                className={`history-tab ${historyTab === 'my' ? 'active' : ''}`}
                onClick={() => { setHistoryTab('my'); setHistoryPage(1); }}
              >
                My Games
              </button>
              <button
                className={`history-tab ${historyTab === 'all' ? 'active' : ''}`}
                onClick={() => { setHistoryTab('all'); setHistoryPage(1); }}
              >
                All Games
              </button>
            </div>
          </div>
          <div className="history-table">
            <div className="history-table-header">
              <div className="th-grid">Grid</div>
              <div className="th-player">Player</div>
              <div className="th-bet">Bet</div>
              <div className="th-result">Result</div>
              <div className="th-payout">Payout</div>
              <div className="th-action"></div>
            </div>
            <div className="history-table-body">
              {historyGames.length === 0 ? (
                <div className="history-empty">No games found</div>
              ) : (
                historyGames.map((hgame) => (
                  <div key={hgame.game_id} className="history-row">
                    <div><span className="history-grid-badge">{hgame.grid_size || 5}x{hgame.grid_size || 5}</span></div>
                    <div>
                      <a
                        href={`https://testnet.monadexplorer.com/address/${hgame.player}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="history-player"
                      >
                        {hgame.player?.slice(0, 6)}...{hgame.player?.slice(-4)}
                      </a>
                    </div>
                    <div className="history-bet">
                      {Number(formatEther(BigInt(hgame.bet_amount || '0'))).toFixed(2)}
                    </div>
                    <div>
                      <span className={`history-result-badge ${hgame.won ? 'won' : 'lost'}`}>
                        {hgame.won ? 'WON' : 'LOST'}
                      </span>
                    </div>
                    <div className={`history-payout ${hgame.won ? 'won' : 'lost'}`}>
                      {hgame.won ? '+' : '-'}
                      {Number(formatEther(BigInt(hgame.won ? hgame.payout || '0' : hgame.bet_amount || '0'))).toFixed(2)}
                    </div>
                    <div className="history-actions">
                      <Link href={`/verify?gameId=${hgame.game_id}`} className="history-action-btn" title="Verify">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                          <path d="M9 12l2 2 4-4"/>
                        </svg>
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="history-pagination">
            <button
              className="pagination-btn"
              onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
              disabled={historyPage <= 1}
            >
              ←
            </button>
            <span className="pagination-info">Page {historyPage}</span>
            <button
              className="pagination-btn"
              onClick={() => setHistoryPage(p => p + 1)}
              disabled={historyGames.length < 10}
            >
              →
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
