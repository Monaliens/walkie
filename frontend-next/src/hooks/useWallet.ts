'use client'

import { useAccount, useDisconnect, useSignMessage, useBalance } from 'wagmi'
import { useMemo, useCallback, useState, useEffect } from 'react'

export function useWallet() {
  const { address, isConnected, isConnecting, isReconnecting, status, chainId } = useAccount()
  const { disconnect } = useDisconnect()
  const { signMessageAsync, isPending: isSigningMessage } = useSignMessage()
  const { data: balanceData } = useBalance({ address })

  // State for client-side appkit
  const [appKitOpen, setAppKitOpen] = useState<(() => void) | null>(null)

  // Load useAppKit only on client
  useEffect(() => {
    const loadAppKit = async () => {
      try {
        const { useAppKit } = await import('@reown/appkit/react')
        // This is a hack to get the open function from the hook
        // We can't call the hook directly in useEffect, so we need to use a workaround
      } catch (e) {
        // console.error('Failed to load AppKit:', e)
      }
    }
    loadAppKit()
  }, [])

  // Sign a message with the connected wallet
  const signMessage = useCallback(async (message: string) => {
    if (!address) {
      throw new Error('No wallet connected')
    }
    return signMessageAsync({ message })
  }, [address, signMessageAsync])

  // Format address for display
  const formatAddress = useCallback((addr?: string) => {
    if (!addr) return ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }, [])

  // Connect function using appkit-button click simulation
  const connect = useCallback(() => {
    // Trigger appkit-button click
    const button = document.querySelector('appkit-button')
    if (button) {
      (button as HTMLElement).click()
    }
  }, [])

  return useMemo(() => ({
    // Connection state
    address: address || null,
    isConnected: Boolean(isConnected && address),
    isConnecting,
    isReconnecting,
    isReady: status !== 'connecting' && status !== 'reconnecting',
    status,
    chainId,

    // Balance
    balance: balanceData?.formatted || '0',
    balanceSymbol: balanceData?.symbol || 'MON',

    // Actions
    connect,
    disconnect,
    signMessage,
    isSigningMessage,

    // Utilities
    formatAddress,
    displayAddress: formatAddress(address),
  }), [
    address,
    isConnected,
    isConnecting,
    isReconnecting,
    status,
    chainId,
    balanceData,
    disconnect,
    connect,
    signMessage,
    isSigningMessage,
    formatAddress,
  ])
}
