const { ethers, network } = require("hardhat");
const { explorerURL } = require("./utils");

async function main() {
  const templateName = "NFTCollection";
  const name = `${templateName}-${network.name}`;

  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContract("Factory");
  const template = await ethers.getContract(templateName);

  const deploymentConfig = {
    owner: deployer.address,
    name,
    symbol: "NFT",
    maxSupply: 1000,
    tokensPerMint: 10,
    treasuryAddress: deployer.address,
    reservedSupply: 100,
  };

  const runtimeConfig = {
    baseURI: "",
    prerevealTokenURI: "",
    publicMintStart: 0,
    publicMintPrice: 0,
    presaleMintStart: 0,
    presaleMintPrice: 0,
    presaleMerkleRoot: ethers.utils.hexZeroPad("0x00", 32),
    metadataUpdatable: true,
    royaltiesBps: 250,
    royaltiesAddress: deployer.address,
  };

  const initTxn = await template.populateTransaction.initialize(
    deploymentConfig,
    runtimeConfig
  );

  console.log(`Deploying template ${templateName} as ${name}...`);
  const deploymentTxn = await factory
    .connect(deployer)
    ["deploy(string,bytes)"](templateName, initTxn.data, {
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("3", "gwei"),
    });
  console.log(`Transaction: ${explorerURL()}/tx/${deploymentTxn.hash}`);

  const deploymentReceipt = await deploymentTxn.wait();
  const deploymentEvent = deploymentReceipt.events.find(
    (e) => e.event === "TemplateDeployed"
  );
  const deploymentAddress = deploymentEvent.args.destination;
  console.log(`Deployed at ${explorerURL()}/address/${deploymentAddress}`);

  const contract = new ethers.Contract(
    deploymentAddress,
    template.interface.format(ethers.utils.FormatTypes.full),
    ethers.provider
  ).connect(deployer);

  console.log("Minting a token...");
  const mintingTxn = await contract.mint(1, {
    maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
    maxPriorityFeePerGas: ethers.utils.parseUnits("3", "gwei"),
  });
  console.log(`Transaction: ${explorerURL()}/tx/${mintingTxn.hash}`);
  await mintingTxn.wait();
  console.log(
    `Minted at https://${
      network.name === "rinkeby" ? "testnets." : ""
    }opensea.io/assets/${deploymentAddress}/0`
  );

  console.log("Updating placeholder URI...");
  const rawTx = await contract.populateTransaction.updateConfig({
    ...runtimeConfig,
    prerevealTokenURI: "ipfs://QmTz7dGHvXghNuh3V64QBwHPXva4chpMR7frpfxCaxvhd4",
  });

  const updateTx = await factory["call(address,bytes)"](
    deploymentAddress,
    rawTx.data,
    {
      maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("3", "gwei"),
    }
  );
  console.log(`Transaction: ${explorerURL()}/tx/${updateTx.hash}`);
  await updateTx.wait();

  console.log("Done!");
}

main();
