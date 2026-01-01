const { ethers, upgrades } = require("hardhat");
const fs = require("fs");

// Monad Mainnet Pyth Entropy addresses
const ENTROPY_ADDRESS = "0xD458261E832415CFd3BAE5E416FdF3230ce6F134";
const ENTROPY_PROVIDER = "0x52DeaA1c84233F7bb8C8A45baeDE41091c616506";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=== Bombomb Deployment ===");
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MON");

  // Deploy parameters
  const minBet = ethers.parseEther("0.01");  // 0.01 MON
  const maxBet = ethers.parseEther("10");    // 10 MON
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

  // Fund contract for payouts (optional)
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
    network: "monad-mainnet",
    chainId: 143,
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
    "deployment.json",
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));

  console.log("\n=== Update Backend .env ===");
  console.log(`BOMBOMB_CONTRACT_ADDRESS=${proxyAddress}`);

  console.log("\n=== Next Steps ===");
  console.log("1. Update backend/.env with the contract address");
  console.log("2. Update frontend/js/config.js with the contract address");
  console.log("3. Fund the contract with more MON for larger payouts");
  console.log("4. Start the backend server with PM2");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
