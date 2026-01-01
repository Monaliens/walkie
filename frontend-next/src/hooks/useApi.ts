'use client'

const API_URL = 'https://walkie.monaliens.xyz/api'
const WS_URL = 'wss://walkie.monaliens.xyz/ws'

// Session token management
let sessionToken: string | null = null

export function setSessionToken(token: string | null) {
  sessionToken = token
}

export function getSessionToken() {
  return sessionToken
}

// API helper functions
async function fetchWithSession(url: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  if (sessionToken) {
    headers['X-Session-Token'] = sessionToken
  }

  const response = await fetch(`${API_URL}${url}`, {
    ...options,
    headers,
  })

  return response.json()
}

export const api = {
  // Session
  createSession: async (signature: string, timestamp: number, player: string) => {
    const response = await fetchWithSession('/session', {
      method: 'POST',
      body: JSON.stringify({ signature, timestamp, player }),
    })

    if (response.success && response.token) {
      sessionToken = response.token
    }

    return response
  },

  checkSession: async () => {
    if (!sessionToken) {
      return { success: true, valid: false }
    }
    return fetchWithSession('/session')
  },

  // Game
  prepareGame: async (gridSize: number) => {
    return fetchWithSession('/game/prepare', {
      method: 'POST',
      body: JSON.stringify({ gridSize }),
    })
  },

  getActiveGame: async (address: string) => {
    return fetchWithSession(`/game/active/${address}`)
  },

  revealTile: async (gameId: string, tileIndex: number) => {
    return fetchWithSession(`/game/${gameId}/reveal`, {
      method: 'POST',
      body: JSON.stringify({ tileIndex }),
    })
  },

  getEntropyFee: async () => {
    return fetchWithSession('/entropy-fee')
  },

  getRecentGames: async (limit: number = 10, offset: number = 0) => {
    return fetchWithSession(`/games/recent?limit=${limit}&offset=${offset}`)
  },

  getPlayerGames: async (address: string, limit: number = 10, offset: number = 0) => {
    return fetchWithSession(`/games/player/${address}?limit=${limit}&offset=${offset}`)
  },
}

// WebSocket management
let ws: WebSocket | null = null
let wsListeners: Map<string, (data: any) => void> = new Map()
let recentGameCallback: (() => void) | null = null

export function setRecentGameCallback(callback: (() => void) | null) {
  recentGameCallback = callback
}

export function connectWebSocket() {
  if (ws?.readyState === WebSocket.OPEN) return

  ws = new WebSocket(WS_URL)

  ws.onopen = () => {
    // console.log('[WS] Connected')
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      // Handle recentGame globally
      if (data.type === 'recentGame' && recentGameCallback) {
        recentGameCallback()
      }
      wsListeners.forEach((callback) => callback(data))
    } catch (e) {
      // Ignore parse errors
    }
  }

  ws.onclose = () => {
    // console.log('[WS] Disconnected')
    // Reconnect after delay
    setTimeout(connectWebSocket, 3000)
  }

  ws.onerror = (error) => {
    // console.error('[WS] Error:', error)
  }
}

export function subscribeToGame(gameId: string, callback: (data: any) => void) {
  wsListeners.set(gameId, callback)

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', gameId }))
  }
}

export function unsubscribeFromGame(gameId: string) {
  wsListeners.delete(gameId)

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe', gameId }))
  }
}
