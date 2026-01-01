const { ethers, upgrades } = require("hardhat");
const fs = require("fs");

// Monad Testnet Pyth Entropy addresses
const ENTROPY_ADDRESS = "0x825c0390f379c631f3cf11a82a37d20bddf93c07";
const ENTROPY_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=== Bombomb Testnet Deployment ===");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MON");

  // Deploy parameters - Testnet limits
  const minBet = ethers.parseEther("0.01");  // 0.01 MON
  const maxBet = ethers.parseEther("1");     // 1 MON
  const feeRecipient = deployer.address;
  const relayer = deployer.address;

  console.log("\n=== Deploy Parameters ===");
  console.log("Entropy:", ENTROPY_ADDRESS);
  console.log("Entropy Provider:", ENTROPY_PROVIDER);
  console.log("Min Bet:", ethers.formatEther(minBet), "MON");
  console.log("Max Bet:", ethers.formatEther(maxBet), "MON");
  console.log("Fee Recipient:", feeRecipient);
  console.log("Relayer:", relayer);

  // Deploy Bombomb
  console.log("\n=== Deploying Bombomb Contract ===");
  const Bombomb = await ethers.getContractFactory("Bombomb");

  const bombomb = await upgrades.deployProxy(
    Bombomb,
    [ENTROPY_ADDRESS, ENTROPY_PROVIDER, minBet, maxBet, feeRecipient, relayer],
    { initializer: "initialize", kind: "uups" }
  );

  await bombomb.waitForDeployment();

  const proxyAddress = await bombomb.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("Proxy:", proxyAddress);
  console.log("Implementation:", implAddress);

  // Check entropy fee
  const entropyFee = await bombomb.getEntropyFee();
  console.log("Entropy Fee:", ethers.formatEther(entropyFee), "MON");

  // Fund contract for payouts
  const fundAmount = ethers.parseEther("1"); // 1 MON initial funding
  console.log("\n=== Funding Contract ===");
  console.log("Sending", ethers.formatEther(fundAmount), "MON to contract...");

  const fundTx = await deployer.sendTransaction({
    to: proxyAddress,
    value: fundAmount
  });
  await fundTx.wait();
  console.log("Funded!");

  const contractBalance = await ethers.provider.getBalance(proxyAddress);
  console.log("Contract Balance:", ethers.formatEther(contractBalance), "MON");

  // Save deployment info
  const deploymentInfo = {
    network: "monad-testnet",
    chainId: 10143,
    bombombProxy: proxyAddress,
    bombombImplementation: implAddress,
    entropy: ENTROPY_ADDRESS,
    entropyProvider: ENTROPY_PROVIDER,
    feeRecipient: feeRecipient,
    relayer: relayer,
    minBet: ethers.formatEther(minBet),
    maxBet: ethers.formatEther(maxBet),
    entropyFee: ethers.formatEther(entropyFee),
    deployedAt: new Date().toISOString()
  };

  fs.writeFileSync(
    "deployment-testnet.json",
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  console.log("\n=== Update Backend .env.testnet ===");
  console.log(`BOMBOMB_CONTRACT_ADDRESS=${proxyAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
