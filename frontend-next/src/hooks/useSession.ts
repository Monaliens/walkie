'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWallet } from './useWallet'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://walkie.monaliens.xyz/api'
const SESSION_KEY = 'bombomb_session_token'
const SESSION_EXPIRES_KEY = 'bombomb_session_expires'
const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '143')

export function useSession() {
  const { address, isConnected, signMessage, isSigningMessage } = useWallet()
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number>(0)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load session from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem(SESSION_KEY)
      const storedExpires = parseInt(localStorage.getItem(SESSION_EXPIRES_KEY) || '0')

      if (storedToken && storedExpires && Date.now() < storedExpires) {
        setToken(storedToken)
        setExpiresAt(storedExpires)
      } else {
        // Clear expired session
        localStorage.removeItem(SESSION_KEY)
        localStorage.removeItem(SESSION_EXPIRES_KEY)
      }
    }
  }, [])

  // Clear session when wallet disconnects or address changes
  useEffect(() => {
    if (!isConnected || !address) {
      setToken(null)
      setExpiresAt(0)
      if (typeof window !== 'undefined') {
        localStorage.removeItem(SESSION_KEY)
        localStorage.removeItem(SESSION_EXPIRES_KEY)
      }
    }
  }, [isConnected, address])

  // Check if session is valid
  const hasValidSession = useCallback(() => {
    return Boolean(token && expiresAt && Date.now() < expiresAt)
  }, [token, expiresAt])

  // Create a new session
  const createSession = useCallback(async () => {
    if (!address || !isConnected) {
      setError('Wallet not connected')
      return false
    }

    if (isCreating || isSigningMessage) {
      return false
    }

    setIsCreating(true)
    setError(null)

    try {
      const timestamp = Math.floor(Date.now() / 1000)
      const message = JSON.stringify({
        type: 'bombomb-session',
        player: address.toLowerCase(),
        timestamp,
        chainId: CHAIN_ID
      })

      // Sign the message
      const signature = await signMessage(message)

      // Send to backend
      const response = await fetch(`${API_URL}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature,
          timestamp,
          player: address
        })
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Session creation failed')
      }

      // Store session
      const newExpiresAt = data.expiresAt || (Date.now() + 3600000) // 1 hour default
      setToken(data.token)
      setExpiresAt(newExpiresAt)

      if (typeof window !== 'undefined') {
        localStorage.setItem(SESSION_KEY, data.token)
        localStorage.setItem(SESSION_EXPIRES_KEY, newExpiresAt.toString())
      }

      return true
    } catch (err: any) {
      // console.error('[Session] Error:', err)
      setError(err.message || 'Failed to create session')
      return false
    } finally {
      setIsCreating(false)
    }
  }, [address, isConnected, signMessage, isCreating, isSigningMessage])

  // Clear session
  const clearSession = useCallback(() => {
    setToken(null)
    setExpiresAt(0)
    setError(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem(SESSION_KEY)
      localStorage.removeItem(SESSION_EXPIRES_KEY)
    }
  }, [])

  return {
    token,
    hasValidSession: hasValidSession(),
    isCreating: isCreating || isSigningMessage,
    error,
    createSession,
    clearSession,
  }
}
