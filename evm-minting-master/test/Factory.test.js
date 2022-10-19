const { expect } = require("chai");
const { ethers } = require("hardhat");
const keccak256 = require("keccak256");

const { deploy } = require("./utils");

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("Factory", () => {
  let factory;
  let template;
  let instance;

  let initData;

  let signers;
  let factoryDeployer;
  let externalUser;
  let collectionDeployer;
  let factorySigner;
  let factoryOwner;

  function random(range) {
    return Math.floor(Math.random() * range);
  }

  async function getFactory() {
    await deployments.fixture(["Factory"]);
    const factory = await ethers.getContract("Factory");

    return factory.connect(factoryOwner);
  }

  async function deployMockImplementation(name, version) {
    const implementation = await deploy("MockTemplate");
    await implementation.setName(name);
    await implementation.setVersion(version);
    return implementation;
  }

  async function deployTemplate() {
    await factory.registerTemplate(template.address);

    const deploymentTxn = await factory
      .connect(collectionDeployer)
      ["deploy(string,bytes)"]("MockTemplate", initData);
    const deploymentReceipt = await deploymentTxn.wait();
    const deploymentEvent = deploymentReceipt.events.find(
      (e) => e.event === "TemplateDeployed"
    );

    const contract = new ethers.Contract(
      deploymentEvent.args.destination,
      template.interface.format(ethers.utils.FormatTypes.full),
      ethers.provider
    );

    return contract;
  }

  async function sign(types, values, messageSigner = factorySigner) {
    const message = ethers.utils.solidityPack(types, values);

    const signature = await messageSigner.signMessage(
      ethers.utils.arrayify(message)
    );

    return signature;
  }

  beforeEach(async () => {
    signers = await ethers.getSigners();
    [
      factoryDeployer,
      factoryOwner,
      factorySigner,
      externalUser,
      collectionDeployer,
    ] = signers;

    factory = await getFactory();
    template = await deploy("MockTemplate");

    const initTxn = await template.populateTransaction.initialize();
    initData = initTxn.data;
  });

  describe("Factory deployment", () => {
    it("Should succeed", async function () {
      await expect(getFactory()).not.to.be.reverted;
    });

    it("Should prevent re-initialization", async () => {
      await expect(
        factory.initialize(factoryOwner.address, factorySigner.address)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should prevent initialization when deployed directly", async () => {
      const contract = await deploy("Factory");

      await expect(
        contract.initialize(factoryOwner.address, factorySigner.address)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Implementation information", () => {
    it("Should expose latest version", async () => {
      await expect(factory.latestVersion("MockTemplate")).not.to.be.reverted;
    });

    it("Should initialize latest version to 0", async () => {
      expect(await factory.latestVersion("MockTemplate")).to.equal(0);
    });

    it("Should expose latest address", async () => {
      await expect(factory.latestImplementation("MockTemplate")).not.to.be
        .reverted;
    });

    it("Should initialize latest address to the null address", async () => {
      expect(await factory.latestImplementation("MockTemplate")).to.equal(
        NULL_ADDRESS
      );
    });
  });

  describe("Template names", () => {
    it("Should be exposed to the public", async () => {
      await expect(factory.templates()).not.to.be.reverted;
    });

    it("Should be initially empty", async () => {
      const templates = await factory.templates();
      expect(templates.length).to.equal(0);
    });
  });

  describe("Registering template implementations", () => {
    let templateName = "MockNFTTemplate";
    let implementation;
    let olderImplementation;
    let newerImplementation;

    beforeEach(async () => {
      implementation = await deployMockImplementation(templateName, 1_00_01);
      newerImplementation = await deployMockImplementation(
        templateName,
        1_01_00
      );
      olderImplementation = await deployMockImplementation(
        templateName,
        1_00_00
      );
    });

    it("Should succeed when called by admin roles", async () => {
      await expect(
        factory.connect(factoryOwner).registerTemplate(implementation.address)
      ).not.to.be.reverted;
    });

    it("Should fail when called by non-admin roles", async () => {
      await expect(
        factory.connect(externalUser).registerTemplate(implementation.address)
      ).to.be.revertedWith("AccessControl:");
    });

    it("Should fail if the implementation address does not point to a contract", async () => {
      await expect(
        factory.connect(factoryOwner).registerTemplate(externalUser.address)
      ).to.be.revertedWith("Not a valid contract");
    });

    it("Should fail if the version already exists", async () => {
      await factory
        .connect(factoryOwner)
        .registerTemplate(implementation.address);

      await expect(
        factory.connect(factoryOwner).registerTemplate(implementation.address)
      ).to.be.revertedWith("Version already exists");
    });

    it("Should update the list of templates if a new one has been added", async () => {
      await factory
        .connect(factoryOwner)
        .registerTemplate(implementation.address);
      const templatesAfter = await factory.templates();
      expect(templatesAfter.length).to.equal(1);
      expect(templatesAfter[0]).to.equal(templateName);
    });

    it("Should not update the list of templates if new version of an existing one is added", async () => {
      await factory
        .connect(factoryOwner)
        .registerTemplate(implementation.address);
      await factory
        .connect(factoryOwner)
        .registerTemplate(newerImplementation.address);

      const templatesAfter = await factory.templates();
      expect(templatesAfter.length).to.equal(1);
      expect(templatesAfter[0]).to.equal(templateName);
    });

    it("Should update the latest version & implementation address if a newer version is added", async () => {
      await factory
        .connect(factoryOwner)
        .registerTemplate(implementation.address);

      expect(await factory.latestVersion(templateName)).to.equal(1_00_01);
      expect(await factory.latestImplementation(templateName)).to.equal(
        await implementation.address
      );
    });

    it("Should not update the latest version & implementation address if an older version is added", async () => {
      await factory
        .connect(factoryOwner)
        .registerTemplate(implementation.address);

      await factory
        .connect(factoryOwner)
        .registerTemplate(olderImplementation.address);

      expect(await factory.latestVersion(templateName)).to.equal(1_00_01);
      expect(await factory.latestImplementation(templateName)).to.equal(
        await implementation.address
      );
    });

    it("Should emit an TemplateAdded event", async () => {
      await expect(
        factory.connect(factoryOwner).registerTemplate(implementation.address)
      )
        .to.emit(factory, "TemplateAdded")
        .withArgs(
          templateName,
          await implementation.VERSION(),
          implementation.address
        );
    });
  });

  describe("Template implementations", () => {
    it("Should be exposed to the public", async () => {
      await expect(factory.latestImplementation("MockTemplate")).not.to.be
        .reverted;
    });

    it("Should be initialized to the null address", async () => {
      expect(await factory.latestImplementation("MockTemplate")).to.equal(
        NULL_ADDRESS
      );
    });
  });

  describe("Fees", () => {
    describe("Deployments", () => {
      it("Should be publicly queryable", async () => {
        await expect(factory.deploymentFee()).not.to.be.reverted;
      });

      it("Should be updatable by admins", async () => {
        await expect(factory.setDeploymentFee(1)).not.to.be.reverted;
      });

      it("Should not be updatable by anyone else", async () => {
        const nonAdmins = signers.filter(
          (s) => s.address !== factoryOwner.address
        );

        for (const caller of nonAdmins) {
          await expect(
            factory.connect(caller).setDeploymentFee(1)
          ).to.be.revertedWith("AccessControl: account 0x");
        }
      });

      it("Should change when updated", async () => {
        const newFee = random(10000);
        await factory.setDeploymentFee(newFee);
        expect(await factory.deploymentFee()).to.equal(newFee);
      });
    });

    describe("Proxied calls", () => {
      it("Should be publicly queryable", async () => {
        await expect(factory.callFee()).not.to.be.reverted;
      });

      it("Should be updatable by admins", async () => {
        await expect(factory.setCallFee(1)).not.to.be.reverted;
      });

      it("Should not be updatable by anyone else", async () => {
        const nonAdmins = signers.filter(
          (s) => s.address !== factoryOwner.address
        );

        for (const caller of nonAdmins) {
          await expect(
            factory.connect(caller).setCallFee(1)
          ).to.be.revertedWith("AccessControl: account 0x");
        }
      });

      it("Should change when updated", async () => {
        const newFee = random(10000);
        await factory.setCallFee(newFee);
        expect(await factory.callFee()).to.equal(newFee);
      });
    });
  });

  describe("Contract deployments", () => {
    let deploymentFee;

    beforeEach(async () => {
      deploymentFee = ethers.BigNumber.from(`${random(1000000)}`);
      await factory.registerTemplate(template.address);
      await factory.setDeploymentFee(deploymentFee);
    });

    describe("Latest version (legacy)", () => {
      it("Should succeed when called by anyone", async () => {
        for (const signer of signers) {
          await expect(
            factory
              .connect(signer)
              ["deploy(string,bytes)"]("MockTemplate", initData, {
                value: deploymentFee,
              })
          ).not.to.be.reverted;
        }
      });

      it("Should fail if the fee is not sufficient", async () => {
        const signer = signers[random(signers.length)];

        await expect(
          factory
            .connect(signer)
            ["deploy(string,bytes)"]("MockTemplate", initData, {
              value: deploymentFee.sub(1),
            })
        ).to.be.revertedWith("Insufficient payment");
      });

      it("Should fail if the implementation is not set", async () => {
        await expect(
          factory["deploy(string,bytes)"]("MockTemplates", initData, {
            value: deploymentFee,
          })
        ).to.be.revertedWith("Missing implementation");
      });

      it("Should emit a TemplateDeployed event on deployment", async () => {
        const args = ["MockTemplate", initData, { value: deploymentFee }];
        const cloneAddress = await factory.callStatic["deploy(string,bytes)"](
          ...args
        );

        await expect(factory["deploy(string,bytes)"](...args))
          .to.emit(factory, "TemplateDeployed")
          .withArgs(
            "MockTemplate",
            await factory.latestVersion("MockTemplate"),
            cloneAddress
          );
      });
    });

    describe("Latest version", () => {
      let caller;
      let validSignature;
      let invalidSignature;

      beforeEach(async () => {
        caller = signers[random(signers.length)];
        validSignature = await sign(
          ["address", "string", "bytes"],
          [caller.address, "MockTemplate", initData]
        );
        invalidSignature = await sign(
          ["address", "string", "bytes"],
          [caller.address, "MockTemplate", initData],
          externalUser
        );
      });

      it("Should succeed if a valid signature is provided", async () => {
        await expect(
          factory
            .connect(caller)
            ["deploy(string,bytes,bytes)"](
              "MockTemplate",
              initData,
              validSignature
            )
        ).not.to.be.reverted;
      });

      it("Should fail if an invalid signature is provided", async () => {
        await expect(
          factory
            .connect(caller)
            ["deploy(string,bytes,bytes)"](
              "MockTemplate",
              initData,
              invalidSignature
            )
        ).to.be.revertedWith("Signer not recognized");
      });

      it("Should fail if the caller doesn't match the signature", async () => {
        await expect(
          factory
            .connect(externalUser)
            ["deploy(string,bytes,bytes)"](
              "MockTemplate",
              initData,
              validSignature
            )
        ).to.be.revertedWith("Signer not recognized");
      });

      it("Should fail if the implementation is not set", async () => {
        const signature = await sign(
          ["address", "string", "bytes"],
          [caller.address, "MockTemplates", initData]
        );

        await expect(
          factory
            .connect(caller)
            ["deploy(string,bytes,bytes)"]("MockTemplates", initData, signature)
        ).to.be.revertedWith("Missing implementation");
      });

      it("Should emit a TemplateDeployed event on deployment", async () => {
        const args = ["MockTemplate", initData, validSignature];
        const cloneAddress = await factory
          .connect(caller)
          .callStatic["deploy(string,bytes,bytes)"](...args);

        await expect(
          factory.connect(caller)["deploy(string,bytes,bytes)"](...args)
        )
          .to.emit(factory, "TemplateDeployed")
          .withArgs(
            "MockTemplate",
            await factory.latestVersion("MockTemplate"),
            cloneAddress
          );
      });
    });

    describe("A specific version", () => {
      let caller;
      let validSignature;
      let invalidSignature;

      const templateName = "MockNFTTemplate";
      const templateVersion = 1_00_00;

      beforeEach(async () => {
        caller = signers[random(signers.length)];

        const currentImplementation = await deployMockImplementation(
          templateName,
          templateVersion
        );
        await factory.registerTemplate(currentImplementation.address);

        validSignature = await sign(
          ["address", "string", "uint256", "bytes"],
          [caller.address, templateName, templateVersion, initData]
        );
        invalidSignature = await sign(
          ["address", "string", "uint256", "bytes"],
          [caller.address, templateName, templateVersion, initData],
          externalUser
        );
      });

      it("Should succeed if a valid signature is provided", async () => {
        await expect(
          factory
            .connect(caller)
            ["deploy(string,uint256,bytes,bytes)"](
              templateName,
              templateVersion,
              initData,
              validSignature
            )
        ).not.to.be.reverted;
      });

      it("Should fail if an invalid signature is provided", async () => {
        await expect(
          factory
            .connect(caller)
            ["deploy(string,uint256,bytes,bytes)"](
              templateName,
              templateVersion,
              initData,
              invalidSignature
            )
        ).to.be.revertedWith("Signer not recognized");
      });

      it("Should fail if the caller doesn't match the signature", async () => {
        await expect(
          factory
            .connect(externalUser)
            ["deploy(string,uint256,bytes,bytes)"](
              templateName,
              templateVersion,
              initData,
              validSignature
            )
        ).to.be.revertedWith("Signer not recognized");
      });

      it("Should fail if the implementation is not set", async () => {
        const signature = await sign(
          ["address", "string", "uint256", "bytes"],
          [caller.address, "MockTemplates", templateVersion, initData]
        );

        await expect(
          factory
            .connect(caller)
            ["deploy(string,uint256,bytes,bytes)"](
              "MockTemplates",
              templateVersion,
              initData,
              signature
            )
        ).to.be.revertedWith("Missing implementation");
      });

      it("Should emit a TemplateDeployed event on deployment", async () => {
        const args = [templateName, templateVersion, initData, validSignature];

        await expect(
          factory.connect(caller)["deploy(string,uint256,bytes,bytes)"](...args)
        )
          .to.emit(factory, "TemplateDeployed")
          .withArgs(templateName, templateVersion, []);
      });

      it("Should deploy the specified version", async () => {
        const olderImplementation = await deployMockImplementation(
          templateName,
          templateVersion - 1
        );
        const newerImplementation = await deployMockImplementation(
          templateName,
          templateVersion + 1
        );

        await factory.registerTemplate(olderImplementation.address);
        await factory.registerTemplate(newerImplementation.address);

        for (const implementation of [
          olderImplementation,
          newerImplementation,
        ]) {
          const version = await implementation.VERSION();
          const signature = await sign(
            ["address", "string", "uint256", "bytes"],
            [caller.address, templateName, version, initData]
          );
          const args = [templateName, version, initData, signature];

          await expect(
            factory
              .connect(caller)
              ["deploy(string,uint256,bytes,bytes)"](...args)
          )
            .to.emit(factory, "TemplateDeployed")
            .withArgs(templateName, version, []);
        }
      });
    });
  });

  describe("Whitelist status", () => {
    beforeEach(async () => {
      instance = await deployTemplate();
    });

    it("Should be exposed to the public", async () => {
      await expect(factory.whitelisted(instance.address)).not.to.be.reverted;
    });

    it("Should default to true for newly deployed contracts", async () => {
      expect(await factory.whitelisted(instance.address)).to.be.true;
    });

    it("Should be updatable by admins", async () => {
      await expect(factory.setWhitelisted(instance.address, true)).not.to.be
        .reverted;
    });

    it("Should not be updatable by external users", async () => {
      await expect(
        factory.connect(externalUser).setWhitelisted(instance.address, true)
      ).to.be.revertedWith("AccessControl: account");
    });

    it("Should change when updated", async () => {
      await factory.setWhitelisted(instance.address, false);
      expect(await factory.whitelisted(instance.address)).to.be.false;
    });
  });

  describe("Operator role", () => {
    beforeEach(async () => {
      instance = await deployTemplate();
    });

    it("Should be generated from instance address", async () => {
      expect(await factory.OPERATOR_ROLE(instance.address)).to.equal(
        "0x" +
          keccak256(
            ethers.utils.solidityPack(
              ["address", "string"],
              [instance.address, "OPERATOR"]
            )
          ).toString("hex")
      );
    });

    it("Should let anyone query its status", async () => {
      await expect(
        factory.isOperator(instance.address, collectionDeployer.address)
      ).not.to.be.reverted;
    });

    it("Should be assigned to the deployer", async () => {
      expect(
        await factory.isOperator(instance.address, collectionDeployer.address)
      ).to.be.true;
    });

    it("Should let an operator assign and revoke it for other addresses", async () => {
      await expect(
        factory
          .connect(collectionDeployer)
          .setOperator(instance.address, externalUser.address, true)
      ).not.to.be.reverted;

      await expect(
        factory
          .connect(collectionDeployer)
          .setOperator(instance.address, externalUser.address, false)
      ).not.to.be.reverted;
    });

    it("Should update role state when changed", async () => {
      await factory
        .connect(collectionDeployer)
        .setOperator(instance.address, externalUser.address, true);
      expect(await factory.isOperator(instance.address, externalUser.address))
        .to.be.true;

      await factory
        .connect(collectionDeployer)
        .setOperator(instance.address, externalUser.address, false);
      expect(await factory.isOperator(instance.address, externalUser.address))
        .to.be.false;
    });

    it("Should not let any other users assign and revoke it", async () => {
      await expect(
        factory
          .connect(externalUser)
          .setOperator(instance.address, collectionDeployer.address, false)
      ).to.be.revertedWith("Access denied");

      await expect(
        factory
          .connect(externalUser)
          .setOperator(instance.address, collectionDeployer.address, true)
      ).to.be.revertedWith("Access denied");
    });

    it("Should not let an operator assign and revoke it for themselves", async () => {
      await expect(
        factory
          .connect(collectionDeployer)
          .setOperator(instance.address, collectionDeployer.address, true)
      ).to.be.revertedWith("Cannot change own role");

      await expect(
        factory
          .connect(collectionDeployer)
          .setOperator(instance.address, collectionDeployer.address, false)
      ).to.be.revertedWith("Cannot change own role");
    });

    it("Should emit an OperatorChanged event when changed", async () => {
      await expect(
        factory
          .connect(collectionDeployer)
          .setOperator(instance.address, externalUser.address, true)
      )
        .to.emit(factory, "OperatorChanged")
        .withArgs(instance.address, externalUser.address, true);
    });
  });

  describe("Contract calls", () => {
    let calldata;
    let callFee;

    beforeEach(async () => {
      callFee = ethers.BigNumber.from(`${random(1000000)}`);
      await factory.setCallFee(callFee);
      instance = await deployTemplate();
      calldata = (await instance.populateTransaction.setName("MockTemplate"))
        .data;
    });

    describe("Unsigned requests", () => {
      it("Should succeed if called by the contract operator", async () => {
        await expect(
          factory
            .connect(collectionDeployer)
            ["call(address,bytes)"](instance.address, calldata, {
              value: callFee,
            })
        ).not.to.be.reverted;
      });

      it("Should fail if the fee is not sufficient", async () => {
        await expect(
          factory
            .connect(collectionDeployer)
            ["call(address,bytes)"](instance.address, calldata, {
              value: callFee.sub(1),
            })
        ).to.be.revertedWith("Insufficient payment");
      });

      it("Should fail if called by non-operators", async () => {
        const nonOperators = signers.filter(
          (s) => s.address !== collectionDeployer.address
        );

        for (const caller of nonOperators) {
          await expect(
            factory
              .connect(caller)
              ["call(address,bytes)"](instance.address, calldata, {
                value: callFee,
              })
          ).to.be.revertedWith("Access denied");
        }
      });

      it("Should fail if the contract is not whitelisted", async () => {
        await factory.setWhitelisted(instance.address, false);

        await expect(
          factory
            .connect(collectionDeployer)
            ["call(address,bytes)"](instance.address, calldata, {
              value: callFee,
            })
        ).to.be.revertedWith("Contract not whitelisted");
      });
    });

    describe("Signed requests", () => {
      it("Should succeed if a valid signature is provided", async () => {
        const signature = sign(
          ["address", "address", "bytes"],
          [collectionDeployer.address, instance.address, calldata]
        );

        await expect(
          factory
            .connect(collectionDeployer)
            ["call(address,bytes,bytes)"](instance.address, calldata, signature)
        ).not.to.be.reverted;
      });

      it("Should fail if an invalid signature is provided", async () => {
        const signature = sign(
          ["address", "address", "bytes"],
          [collectionDeployer.address, instance.address, calldata],
          collectionDeployer
        );

        await expect(
          factory
            .connect(collectionDeployer)
            ["call(address,bytes,bytes)"](instance.address, calldata, signature)
        ).to.be.revertedWith("Signer not recognized");
      });

      it("Should fail if called by non-operators", async () => {
        const nonOperators = signers.filter(
          (s) => s.address !== collectionDeployer.address
        );

        for (const caller of nonOperators) {
          const signature = sign(
            ["address", "address", "bytes"],
            [caller.address, instance.address, calldata]
          );

          await expect(
            factory
              .connect(caller)
              ["call(address,bytes,bytes)"](
                instance.address,
                calldata,
                signature
              )
          ).to.be.revertedWith("Access denied");
        }
      });

      it("Should fail if the contract is not whitelisted", async () => {
        await factory.setWhitelisted(instance.address, false);

        const signature = sign(
          ["address", "address", "bytes"],
          [collectionDeployer.address, instance.address, calldata]
        );

        await expect(
          factory
            .connect(collectionDeployer)
            ["call(address,bytes,bytes)"](instance.address, calldata, signature)
        ).to.be.revertedWith("Contract not whitelisted");
      });
    });
  });

  describe("Admin role", () => {
    let ADMIN_ROLE;

    beforeEach(async () => {
      ADMIN_ROLE = await factory.ADMIN_ROLE();
    });

    it("Should be assigned to the owner", async () => {
      expect(factory.hasRole(ADMIN_ROLE, factoryOwner.address));
    });

    it("Should let admin addresses grant the role", async () => {
      await expect(factory.grantRole(ADMIN_ROLE, externalUser.address)).not.to
        .be.reverted;
      expect(await factory.hasRole(ADMIN_ROLE, externalUser.address)).to.be
        .true;
    });

    it("Should not let external addresses grant the role", async () => {
      await expect(
        factory
          .connect(externalUser)
          .grantRole(ADMIN_ROLE, externalUser.address)
      ).to.be.revertedWith("AccessControl: account 0x");
      expect(await factory.hasRole(ADMIN_ROLE, externalUser.address)).to.be
        .false;
    });

    it("Should let admins revoke the role", async () => {
      await factory.grantRole(ADMIN_ROLE, externalUser.address);
      await expect(factory.revokeRole(ADMIN_ROLE, externalUser.address)).not.to
        .be.reverted;
      expect(await factory.hasRole(ADMIN_ROLE, externalUser.address)).to.be
        .false;
    });

    it("Should not let external users revoke the role", async () => {
      await expect(
        factory
          .connect(externalUser)
          .revokeRole(ADMIN_ROLE, factoryOwner.address)
      ).to.be.revertedWith("AccessControl: account 0x");
      expect(await factory.hasRole(ADMIN_ROLE, factoryOwner.address)).to.be
        .true;
    });
  });

  describe("Signer role", () => {
    let SIGNER_ROLE;

    beforeEach(async () => {
      SIGNER_ROLE = await factory.SIGNER_ROLE();
    });

    it("Should be assigned to the signer", async () => {
      expect(factory.hasRole(SIGNER_ROLE, factorySigner.address));
    });

    it("Should let admin addresses grant the role", async () => {
      await expect(factory.grantRole(SIGNER_ROLE, externalUser.address)).not.to
        .be.reverted;
      expect(await factory.hasRole(SIGNER_ROLE, externalUser.address)).to.be
        .true;
    });

    it("Should not let external addresses grant the role", async () => {
      await expect(
        factory
          .connect(externalUser)
          .grantRole(SIGNER_ROLE, externalUser.address)
      ).to.be.revertedWith("AccessControl: account 0x");
      expect(await factory.hasRole(SIGNER_ROLE, externalUser.address)).to.be
        .false;
    });

    it("Should let admins revoke the role", async () => {
      await factory.grantRole(SIGNER_ROLE, externalUser.address);
      await expect(factory.revokeRole(SIGNER_ROLE, externalUser.address)).not.to
        .be.reverted;
      expect(await factory.hasRole(SIGNER_ROLE, externalUser.address)).to.be
        .false;
    });

    it("Should not let external users revoke the role", async () => {
      await expect(
        factory
          .connect(externalUser)
          .revokeRole(SIGNER_ROLE, factorySigner.address)
      ).to.be.revertedWith("AccessControl: account 0x");
      expect(await factory.hasRole(SIGNER_ROLE, factorySigner.address)).to.be
        .true;
    });
  });

  describe("Withdrawing fees", () => {
    beforeEach(async () => {
      const callFee = ethers.utils.parseEther(`${Math.random() * 10}`);
      await factory.setCallFee(callFee);

      instance = await deployTemplate();
      calldata = (await instance.populateTransaction.setName("MockTemplate"))
        .data;

      await factory
        .connect(collectionDeployer)
        ["call(address,bytes)"](instance.address, calldata, {
          value: callFee,
        });
    });

    it("Should succeed when called by admin roles", async () => {
      await expect(factory.withdrawFees(factoryDeployer.address)).not.to.be
        .reverted;
    });

    it("Should fail when called by anyone else", async () => {
      const nonAdmins = signers.filter(
        (s) => s.address !== factoryOwner.address
      );

      for (const caller of nonAdmins) {
        await expect(
          factory.connect(caller).withdrawFees(caller.address)
        ).to.be.revertedWith("AccessControl: account 0x");
      }
    });

    it("Should transfer all funds from the contract to the target address", async () => {
      const contractBalanceBefore = await ethers.provider.getBalance(
        factory.address
      );
      const userBalanceBefore = await ethers.provider.getBalance(
        externalUser.address
      );

      expect(contractBalanceBefore.gt(0)).to.be.true;

      await factory.withdrawFees(externalUser.address);

      const contractBalanceAfter = await ethers.provider.getBalance(
        factory.address
      );
      const userBalanceAfter = await ethers.provider.getBalance(
        externalUser.address
      );

      expect(contractBalanceAfter).to.equal(0);
      expect(userBalanceAfter.sub(userBalanceBefore)).to.equal(
        contractBalanceBefore
      );
    });
  });

  describe("Contract upgrades", () => {
    beforeEach(async () => {
      factory = await deploy("Factory");
    });

    it("Should succeed when called by anyone", async () => {
      const caller = signers[random(signers.length)];

      await expect(factory.connect(caller).upgrade()).not.to.be.reverted;
    });

    it("Should update contract version", async () => {
      expect(await factory.version()).not.to.equal(
        await factory.CODE_VERSION()
      );
      await factory.upgrade();
      expect(await factory.version()).to.equal(await factory.CODE_VERSION());
    });

    it("Should fail when already up-to-date", async () => {
      await factory.upgrade();
      await expect(factory.upgrade()).to.be.revertedWith("Already upgraded");
    });
  });
});
