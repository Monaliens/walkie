'use client'

import { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, State } from 'wagmi'
import { createAppKit } from '@reown/appkit/react'
import { config, networks, projectId, wagmiAdapter, monadMainnet } from '../config/reownConfig'

const queryClient = new QueryClient()

// Metadata for AppKit
const metadata = {
  name: 'Walkie',
  description: 'Provably fair tile-reveal game on Monad. Powered by Pyth Entropy VRF.',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://walkie.monaliens.xyz',
  icons: ['/fox-icon.png'],
}

// Initialize AppKit at module level - must happen before React renders
// Only run on client side
if (typeof window !== 'undefined' && projectId) {
  createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks,
    defaultNetwork: monadMainnet as any,
    metadata,
    features: {
      analytics: false,
      email: false,
      socials: false,
    },
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#9966ff',
      '--w3m-border-radius-master': '0px',
      '--w3m-font-family': '"Press Start 2P", monospace',
      '--w3m-font-size-master': '8px',
    },
  } as any)
}

interface Web3ProviderProps {
  children: ReactNode
  initialState?: State
}

export function Web3Provider({ children, initialState }: Web3ProviderProps) {
  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
