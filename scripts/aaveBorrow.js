const { getNamedAccounts, ethers, network } = require("hardhat")
const { getWeth, AMOUNT } = require("../scripts/getWeth")
const { networkConfig } = require("../helper-hardhat-config")
const {
    ChainId,
    Token,
    WETH,
    Fetcher,
    Trade,
    Route,
    TokenAmount,
    TradeType,
    Percent,
} = require("@uniswap/sdk")

async function main() {
    await getWeth()
    const { deployer } = await getNamedAccounts()
    const lendingPool = await getLendingPool(deployer)
    console.log(`lending pool address ${lendingPool.address}`)

    const wethTokenAdress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    await approveErc20(wethTokenAdress, lendingPool.address, AMOUNT, deployer)
    console.log("Depositing...")
    await lendingPool.deposit(wethTokenAdress, AMOUNT, deployer, 0)
    console.log("Deposited!")

    let borrowData = await getBorrowerUserData(lendingPool, deployer)

    const daiPrice = await getDaiPrice()
    const amountDaiToBorrow =
        borrowData.availableBorrowsETH.toString() * 0.95 * (1 / daiPrice.toNumber())
    console.log(`You can borrow ${amountDaiToBorrow} DAI`)

    const amaountDaiToBorrowWei = ethers.utils.parseEther(amountDaiToBorrow.toString())
    const daiTokenAddress = networkConfig[network.config.chainId].daiToken
    await borrowDai(daiTokenAddress, lendingPool, amaountDaiToBorrowWei, deployer)
    await getBorrowerUserData(lendingPool, deployer)

    await repay(amaountDaiToBorrowWei, daiTokenAddress, lendingPool, deployer)
    borrowData = await getBorrowerUserData(lendingPool, deployer)

    daiBalance = ((await getBalance(daiTokenAddress, deployer)) * (1 / daiPrice)).toString()
    console.log(`dai balance: ${daiBalance}`)
    await uniswap(borrowData.totalDebtETH * 2, deployer)
    daiBalance = ((await getBalance(daiTokenAddress, deployer)) * (1 / daiPrice)).toString()
    console.log(`dai balance: ${daiBalance}`)

    borrowData = await getBorrowerUserData(lendingPool, deployer)
    const amountDaiToRepay = ethers.utils.parseEther(daiBalance)
    await repay(amountDaiToRepay, daiTokenAddress, lendingPool, deployer)
    await getBorrowerUserData(lendingPool, deployer)
}

async function getDaiPrice() {
    const daiEthPriceFeed = await ethers.getContractAt(
        "AggregatorV3Interface",
        networkConfig[network.config.chainId].daiEthPriceFeed
    )
    const price = (await daiEthPriceFeed.latestRoundData())[1]
    console.log(`The DAI/ETH price is ${price.toString()}`)
    return price
}

async function borrowDai(daiAddress, lendingPool, amaountDaiToBorrowWei, account) {
    const borrowTx = await lendingPool.borrow(daiAddress, amaountDaiToBorrowWei, 1, 0, account)
    await borrowTx.wait(1)
    console.log("you've successfully borrowed ")
}

async function repay(amount, daiAddress, lendingPool, account) {
    await approveErc20(daiAddress, lendingPool.address, amount, account)
    const repayTx = await lendingPool.repay(daiAddress, amount, 1, account)
    await repayTx.wait(1)
    console.log(`Repayed!`)
}

async function approveErc20(contractAdress, spenderAdress, amount, signer) {
    const erc20Token = await ethers.getContractAt("IERC20", contractAdress, signer)
    txResponse = await erc20Token.approve(spenderAdress, amount)
    await txResponse.wait(1)
    console.log("Approved!")
}
async function getBalance(contractAdress, signer) {
    const balanceOfERC20 = await ethers.getContractAt("IERC20", contractAdress, signer)
    txResponse = await balanceOfERC20.balanceOf(signer)
    return txResponse
}

async function getBorrowerUserData(lendingPool, account) {
    const { totalCollateralETH, totalDebtETH, availableBorrowsETH } =
        await lendingPool.getUserAccountData(account)
    console.log(`You have ${totalCollateralETH} worth of ETH deposited.`)
    console.log(`You have ${totalDebtETH} worth of ETH borrowed.`)
    console.log(`You can borrow ${availableBorrowsETH} worth of ETH`)
    return { availableBorrowsETH, totalDebtETH }
}

async function getLendingPool(account) {
    const lendingPoolAddressesProvider = await ethers.getContractAt(
        "ILendingPoolAddressesProvider",
        networkConfig[network.config.chainId].lendingPoolAddressesProvider,
        account
    )
    const lendingPoolAddress = await lendingPoolAddressesProvider.getLendingPool()
    const lendingPool = await ethers.getContractAt("ILendingPool", lendingPoolAddress, account)
    return lendingPool
}
async function uniswap(amount, deployer) {
    console.log(`Swapping on uniswap the left amount of ${amount}`)
    const DAI = new Token(
        ChainId.MAINNET,
        "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        18,
        "DAI",
        "Dai Stablecoin"
    )
    const pair = await Fetcher.fetchPairData(DAI, WETH[DAI.chainId])

    const route = new Route([pair], WETH[DAI.chainId])
    const trade = new Trade(
        route,
        new TokenAmount(WETH[DAI.chainId], amount),
        TradeType.EXACT_INPUT
    )
    const slippageTolerance = new Percent("50", "10000") // 50 bips, or 0.50%

    const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw
    const path = [WETH[DAI.chainId].address, DAI.address]
    const to = deployer.toString() // should be a checksummed recipient address
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes from the current Unix time
    const value = trade.inputAmount.raw
    const provider = ethers.provider
    const signer = new ethers.Wallet(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        provider
    )
    const uniswap = new ethers.Contract(
        "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        [
            "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
        ],
        signer
    )
    const tx = await uniswap.swapExactETHForTokens(String(amountOutMin), path, to, deadline, {
        value: String(value),
    })
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.log(error)
        process.exit(1)
    })
