/**
 * Helper script for disabling a factory contract (e.g. a test deployment)
 */

const chalk = require("chalk");
const { ethers } = require("hardhat");
const { explorerURL } = require("./utils");

async function main() {
  const [_, factoryOwner] = await ethers.getSigners();
  const factory = await ethers.getContract("Factory");
  const templates = await factory.templates();

  console.log(chalk.blue("Checking/disabling templates:"));
  for (const template of templates) {
    process.stdout.write(`${template}: `);

    if ((await factory.implementations(template)) !== factory.address) {
      const tx = await factory
        .connect(factoryOwner)
        .setImplementation(template, factory.address);
      process.stdout.write(`${explorerURL()}/tx/${tx.hash} `);
      await tx.wait();
    }

    if ((await factory.implementations(template)) === factory.address) {
      console.log("✅");
    } else {
      console.log("🛑");
    }
  }
}

main();
