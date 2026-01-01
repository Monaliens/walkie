const { ethers, upgrades } = require("hardhat");

const PROXY_ADDRESS = "0x7f7B8135d5D4ba22d3acA7f40676Ba9D89FDe731";

async function main() {
  console.log("Upgrading Bombomb...");
  console.log("Proxy address:", PROXY_ADDRESS);

  const Bombomb = await ethers.getContractFactory("Bombomb");

  console.log("Deploying new implementation...");
  const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, Bombomb);
  await upgraded.waitForDeployment();

  const implAddress = await upgrades.erc1967.getImplementationAddress(PROXY_ADDRESS);
  console.log("New implementation deployed to:", implAddress);
  console.log("Proxy address (unchanged):", PROXY_ADDRESS);
  console.log("");
  console.log("Upgrade complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
