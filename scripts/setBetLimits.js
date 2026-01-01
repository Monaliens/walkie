const { ethers } = require("hardhat");

const PROXY_ADDRESS = "0x7f7B8135d5D4ba22d3acA7f40676Ba9D89FDe731";

async function main() {
  const Bombomb = await ethers.getContractFactory("Bombomb");
  const contract = Bombomb.attach(PROXY_ADDRESS);

  const minBet = ethers.parseEther("0.1");
  const maxBet = ethers.parseEther("10");

  console.log("Setting bet limits...");
  console.log("Min bet:", ethers.formatEther(minBet), "MON");
  console.log("Max bet:", ethers.formatEther(maxBet), "MON");

  const tx = await contract.setBetLimits(minBet, maxBet);
  await tx.wait();

  console.log("Bet limits updated!");
  console.log("Tx hash:", tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
