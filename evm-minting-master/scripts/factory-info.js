const { ethers, network } = require("hardhat");

async function main() {
  const factory = await ethers.getContract("Factory");
  console.log("[Factory]");
  console.log(`Code version: ${await factory.CODE_VERSION()}`);
  console.log(`State version: ${await factory.version()}`);

  const templateNames = await factory.templates();
  for (const templateName of templateNames) {
    console.log(`\n[${templateName}]`);
    console.log("Latest implementation:");
    console.log(
      `${await factory.latestVersion(
        templateName
      )} -> ${await factory.latestImplementation(templateName)}`
    );
    console.log("All implementations:");
    const versions = await factory.versions(templateName);
    for (const templateVersion of versions) {
      console.log(
        `${templateVersion} -> ${await factory.implementation(
          templateName,
          templateVersion
        )}`
      );
    }
  }
}

main();
