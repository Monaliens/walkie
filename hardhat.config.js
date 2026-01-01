require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    monad: {
      url: process.env.RPC_URL || "https://rpc.monad.xyz",
      chainId: 143,
      accounts: [PRIVATE_KEY],
      gasPrice: "auto"
    },
    "monad-testnet": {
      url: "https://monad-testnet.g.alchemy.com/v2/Q-0TaCPvayQJa2UUED-YhA3YkSzajS0R",
      chainId: 10143,
      accounts: [PRIVATE_KEY],
      gasPrice: "auto"
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
