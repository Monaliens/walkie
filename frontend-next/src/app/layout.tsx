import type { Metadata } from "next";
import { Web3Provider } from "@/context/Web3Provider";
import "./variables.css";
import "./main.css";
import "./grid.css";

export const metadata: Metadata = {
  title: "WALKIE by Monaliens",
  description: "Provably fair tile-reveal game on Monad. Powered by Pyth Entropy VRF.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet" />
        {/* Preload King sprites for smooth animations */}
        <link rel="preload" href="/assets/sprites/king/King_Idle.png" as="image" />
        <link rel="preload" href="/assets/sprites/king/King_Walk.png" as="image" />
        <link rel="preload" href="/assets/sprites/king/King_Death.png" as="image" />
        <link rel="preload" href="/assets/sprites/king/tile_unrevealed.png" as="image" />
        <link rel="preload" href="/assets/sprites/king/tile_safe.png" as="image" />
        <link rel="preload" href="/assets/sprites/king/tile_treasure.png" as="image" />
        <link rel="preload" href="/assets/sprites/king/tile_trap.png" as="image" />
        {/* ethers.js - local file for reliable loading */}
        <script src="/js/ethers.min.js" />
      </head>
      <body>
        <Web3Provider>
          {children}
        </Web3Provider>
      </body>
    </html>
  );
}
