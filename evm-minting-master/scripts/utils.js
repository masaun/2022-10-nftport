function explorerURL() {
  if (network.name === "rinkeby") {
    return "https://rinkeby.etherscan.io";
  } else if (network.name === "mainnet") {
    return "https://etherscan.io";
  } else if (network.name === "polygon") {
    return "https://polygonscan.com";
  }

  return "localhost";
}

module.exports = { explorerURL };
