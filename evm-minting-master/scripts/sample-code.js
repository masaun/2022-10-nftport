const Web3 = require("web3");
const web3 = new Web3("http://127.0.0.1:8545");

const Factory = require("../deployments/localhost/Factory.json");
const NFTCollection = require("../deployments/localhost/NFTCollection.json");

const factory = new web3.eth.Contract(Factory.abi, Factory.address);
const collection = new web3.eth.Contract(
  NFTCollection.abi,
  NFTCollection.address
);

const accountAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const accountPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const deploymentConfig = {
  owner: accountAddress,
  name: "NFTCollection",
  symbol: "NFT",
  maxSupply: 1000,
  tokensPerMint: 10,
  mintPrice: web3.utils.toWei("0.05", "ether"),
  treasuryAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  reservedSupply: 0,
};
const runtimeConfig = {
  baseURI: "",
  prerevealTokenURI: "",
  publicMintStart: Math.floor(Date.now() / 1000) + 360000,
  presaleMintStart: Math.floor(Date.now() / 1000) + 360000,
  presaleMerkleRoot: web3.utils.padLeft("0x0", 64), // Needs to be a 32-bit hex
  metadataUpdatable: true,
  royaltiesBps: 250,
  royaltiesAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
};

/**
 * Deploy a new NFTCollection contract using the factory
 */
async function deployCollection() {
  // First we need to generate calldata for the collection initializer
  const initData = collection.methods
    .initialize(deploymentConfig, runtimeConfig)
    .encodeABI();

  // Next we need to generate the payload that will be signed.
  // This is just the caller address, template name and init data all packed together
  const payload = web3.utils.encodePacked(
    accountAddress,
    "NFTCollection",
    initData
  );

  // Now we sign the payload and get the signature that needs to be passed to the factory
  const { signature } = web3.eth.accounts.sign(payload, accountPrivateKey);

  // Finally we call the factory to deploy a new instance
  const txn = await factory.methods
    .deploy("NFTCollection", initData, signature)
    .send({ from: accountAddress });

  // We get the deployed collection address from transaction logs
  return txn.events.TemplateDeployed.returnValues.destination;
}

/**
 * Call a deployed NFTCollection contract directly (for read-only operations)
 */
async function queryCollection(collectionAddress) {
  const collection = new web3.eth.Contract(
    NFTCollection.abi,
    collectionAddress
  );

  return collection.methods.getInfo().call();
}

/**
 * Call a deployed NFTCollection through the factory (for on-chain transactions)
 */
async function callCollection() {
  // Deploy a new NFTCollection instance
  const collectionAddress = await deployCollection();

  // Get the contract state before the update
  console.log("Before:", {
    baseURI: (await queryCollection(collectionAddress)).runtimeConfig.baseURI,
  });

  // Set up the contract object
  const collection = new web3.eth.Contract(
    NFTCollection.abi,
    collectionAddress
  );

  // Generate calldata as if calling the contract directly
  const calldata = collection.methods
    .updateConfig({
      ...runtimeConfig,
      baseURI: `ipfs://${Math.random()}/`,
    })
    .encodeABI();

  // Construct the payload for signing
  const payload = web3.utils.encodePacked(
    accountAddress,
    collectionAddress,
    calldata
  );

  // Sign the payload and get the signature
  const { signature } = web3.eth.accounts.sign(payload, accountPrivateKey);

  // Invoke the call() of the factory
  await factory.methods
    .call(collectionAddress, calldata, signature)
    .send({ from: accountAddress });

  // Get the contract state after the update
  console.log("After:", {
    baseURI: (await queryCollection(collectionAddress)).runtimeConfig.baseURI,
  });
}

callCollection();
