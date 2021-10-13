import { request, gql } from "graphql-request";
const express = require("express");
import BigNumber from "bignumber.js";
const fetch = require("node-fetch");
const http = require("http");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const graphqlEndpointV2 =
    "https://api.thegraph.com/subgraphs/name/bacon-labs/eighty-eight-mph";
const graphqlEndpointV3 =
    "https://api.thegraph.com/subgraphs/name/bacon-labs/eighty-eight-mph-v3";
const graphqlEndpointAvalanche =
    "https://api.thegraph.com/subgraphs/name/bacon-labs/eighty-eight-mph-v3-avalanche";
const graphqlEndpointFantom =
    "https://api.thegraph.com/subgraphs/name/bacon-labs/eighty-eight-mph-v3-fantom";
const graphqlEndpointPolygon =
    "https://api.thegraph.com/subgraphs/name/bacon-labs/eighty-eight-mph-v3-polygon";
const YEAR_IN_SEC = 31556952;
const MPH_ADDR = "0x8888801aF4d980682e47f1A9036e589479e835C5";

interface PoolInfo {
    name: string;
    address: string;
    stablecoin: string;
    stablecoinSymbol: string;
    stablecoinDecimals: number;
    protocol: string;
    iconPath: string;
    moneyMarket: string;
}

interface CachedPrice {
    price: number;
    lastUpdateTime: number;
}

let tokenPriceCache = [];
const cacheUpdateInterval = 300e3;

const httpsGet = async (apiStr, cacheMaxAge: number = 60) => {
    const request = await fetch(apiStr, {
        headers: { "Cache-Control": `max-age=${cacheMaxAge}` },
    });
    return await request.json();
};

const getTokenPriceUSD = async (
    address: string,
    platform: string = "ethereum"
): Promise<number> => {
    if (
        address.toLowerCase() ===
        "0x5B5CFE992AdAC0C9D48E05854B2d91C73a003858".toLowerCase()
    ) {
        // crvHUSD
        return 1;
    } else if (
        address.toLowerCase() ===
        "0xb19059ebb43466C323583928285a49f558E572Fd".toLowerCase()
    ) {
        // crvHBTC
        address = "0x0316EB71485b0Ab14103307bf65a021042c6d380";
    } else if (
        address.toLowerCase() ===
        "0x2fE94ea3d5d4a175184081439753DE15AeF9d614".toLowerCase()
    ) {
        // crvOBTC
        address = "0x8064d9Ae6cDf087b1bcd5BDf3531bD5d8C537a68";
    } else if (
        address.toLowerCase() ===
        "0x06325440D014e39736583c165C2963BA99fAf14E".toLowerCase()
    ) {
        // CRV:STETH
        address = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    } else if (
        address.toLowerCase() ===
        "0x49849C98ae39Fff122806C06791Fa73784FB3675".toLowerCase()
    ) {
        // CRV:RENWBTC
        address = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
    } else if (
        address.toLowerCase() ===
        "0x075b1bb99792c9E1041bA13afEf80C91a1e70fB3".toLowerCase()
    ) {
        // CRV:RENWSBTC
        address = "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599";
    }

    const cachedPrice: CachedPrice = tokenPriceCache[address];
    if (
        cachedPrice &&
        Date.now() <= cachedPrice.lastUpdateTime + cacheUpdateInterval
    ) {
        // use cached price
        return cachedPrice.price;
    }

    const apiStr = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${address}/market_chart/?vs_currency=usd&days=0`;
    const rawResult = await httpsGet(apiStr, 300);
    const price = rawResult.prices[0][1];
    tokenPriceCache[address] = {
        price,
        lastUpdateTime: Date.now(),
    } as CachedPrice;
    return price;
};

const getMPHPriceUSD = async (): Promise<BigNumber> => {
    return new BigNumber(await getTokenPriceUSD(MPH_ADDR));
};

const getRawPoolList = (version: string) => {
    let poolListPath;
    switch (version) {
        case "2":
            poolListPath = "./pools.json";
            break;
        case "3":
            poolListPath = "./pools-v3.json";
            break;
        case "avalanche":
            poolListPath = "./pools-avalanche.json";
            break;
        case "fantom":
            poolListPath = "./pools-fantom.json";
            break;
        case "polygon":
            poolListPath = "./pools-polygon.json";
            break;
        default:
            poolListPath = "./pools-v3.json";
            break;
    }
    return require(poolListPath);
};

const getPoolInfo = (name: string, version: string = "3"): PoolInfo => {
    return getRawPoolList(version)[name];
};

const getPoolInfoList = (version: string = "3"): PoolInfo[] => {
    return Object.keys(getRawPoolList(version)).map((pool) =>
        getPoolInfo(pool, version)
    );
};

const getPoolInfoFromAddress = (
    address: string,
    version: string = "3"
): PoolInfo => {
    return getPoolInfoList(version).find(
        (poolInfo) => poolInfo.address.toLowerCase() === address.toLowerCase()
    );
};

// v2
const v2Handler = (req, res) => {
    const query = gql`
        {
            dpools {
                id
                address
                stablecoin
                totalActiveDeposit
                oneYearInterestRate
                mphDepositorRewardMintMultiplier
                mphDepositorRewardTakeBackMultiplier
            }
        }
    `;

    request(graphqlEndpointV2, query).then(async (data) => {
        const dpools = data.dpools;
        const response = [];
        if (dpools) {
            const mphPriceUSD = await getMPHPriceUSD();
            await Promise.all(
                dpools.map(async (pool) => {
                    const poolInfo = getPoolInfoFromAddress(pool.address, "2");

                    // get MPH APY
                    const stablecoinPrice = await getTokenPriceUSD(
                        pool.stablecoin
                    );
                    const mphDepositorRewardMintMultiplier = new BigNumber(
                        pool.mphDepositorRewardMintMultiplier
                    );
                    const mphDepositorRewardTakeBackMultiplier = new BigNumber(
                        pool.mphDepositorRewardTakeBackMultiplier
                    );
                    const tempMPHAPY = mphDepositorRewardMintMultiplier
                        .times(mphPriceUSD)
                        .times(YEAR_IN_SEC)
                        .div(stablecoinPrice)
                        .times(100);
                    const mphAPY = tempMPHAPY.times(
                        new BigNumber(1).minus(
                            mphDepositorRewardTakeBackMultiplier
                        )
                    );

                    const totalValueLockedInToken = new BigNumber(
                        pool.totalActiveDeposit
                    );
                    const totalValueLockedInUSD =
                        totalValueLockedInToken.times(stablecoinPrice);

                    const poolObj = {
                        address: pool.address,
                        token: pool.stablecoin,
                        tokenSymbol: poolInfo.stablecoinSymbol,
                        protocol: poolInfo.protocol,
                        oneYearInterestRate: new BigNumber(
                            pool.oneYearInterestRate
                        )
                            .times(100)
                            .toString(),
                        mphAPY: mphAPY.toString(),
                        totalValueLockedInToken:
                            totalValueLockedInToken.toString(),
                        totalValueLockedInUSD: totalValueLockedInUSD.toString(),
                    };
                    response.push(poolObj);
                })
            );
        }

        // send response
        res.send(response);
    });
};
app.get("/pools", v2Handler);
app.get("/v2/pools", v2Handler);

// v3
app.get("/v3/pools", (req, res) => {
    const query = gql`
        {
            dpools {
                id
                address
                stablecoin
                totalDeposit
                oneYearInterestRate
                poolDepositorRewardMintMultiplier
            }
        }
    `;

    request(graphqlEndpointV3, query).then(async (data) => {
        const dpools = data.dpools;
        const response = [];
        if (dpools) {
            const mphPriceUSD = await getMPHPriceUSD();
            await Promise.all(
                dpools.map(async (pool) => {
                    const poolInfo = getPoolInfoFromAddress(pool.address);

                    // get MPH APY
                    const stablecoinPrice = await getTokenPriceUSD(
                        pool.stablecoin
                    );
                    const mphDepositorRewardMintMultiplier = new BigNumber(
                        pool.poolDepositorRewardMintMultiplier
                    );
                    const mphAPY = mphDepositorRewardMintMultiplier
                        .times(mphPriceUSD)
                        .times(YEAR_IN_SEC)
                        .div(stablecoinPrice)
                        .times(100);

                    const totalValueLockedInToken = new BigNumber(
                        pool.totalDeposit
                    );
                    const totalValueLockedInUSD =
                        totalValueLockedInToken.times(stablecoinPrice);

                    const poolObj = {
                        address: pool.address,
                        token: pool.stablecoin,
                        tokenSymbol: poolInfo.stablecoinSymbol,
                        protocol: poolInfo.protocol,
                        oneYearInterestRate: new BigNumber(
                            pool.oneYearInterestRate
                        )
                            .times(100)
                            .toString(),
                        mphAPY: mphAPY.toString(),
                        totalValueLockedInToken:
                            totalValueLockedInToken.toString(),
                        totalValueLockedInUSD: totalValueLockedInUSD.toString(),
                    };
                    response.push(poolObj);
                })
            );
        }

        // send response
        res.send(response);
    });
});

// v3 avalanche
app.get("/v3/avalanche/pools", (req, res) => {
    const query = gql`
        {
            dpools {
                id
                address
                stablecoin
                totalDeposit
                oneYearInterestRate
                poolDepositorRewardMintMultiplier
            }
        }
    `;

    request(graphqlEndpointAvalanche, query).then(async (data) => {
        const dpools = data.dpools;
        const response = [];
        if (dpools) {
            const mphPriceUSD = await getMPHPriceUSD();
            await Promise.all(
                dpools.map(async (pool) => {
                    const poolInfo = getPoolInfoFromAddress(pool.address, "avalanche");

                    // get MPH APY
                    const stablecoinPrice = await getTokenPriceUSD(
                        pool.stablecoin,
                        "avalanche"
                    );
                    const mphDepositorRewardMintMultiplier = new BigNumber(
                        pool.poolDepositorRewardMintMultiplier
                    );
                    const mphAPY = mphDepositorRewardMintMultiplier
                        .times(mphPriceUSD)
                        .times(YEAR_IN_SEC)
                        .div(stablecoinPrice)
                        .times(100);

                    const totalValueLockedInToken = new BigNumber(
                        pool.totalDeposit
                    );
                    const totalValueLockedInUSD =
                        totalValueLockedInToken.times(stablecoinPrice);

                    const poolObj = {
                        address: pool.address,
                        token: pool.stablecoin,
                        tokenSymbol: poolInfo.stablecoinSymbol,
                        protocol: poolInfo.protocol,
                        oneYearInterestRate: new BigNumber(
                            pool.oneYearInterestRate
                        )
                            .times(100)
                            .toString(),
                        mphAPY: mphAPY.toString(),
                        totalValueLockedInToken:
                            totalValueLockedInToken.toString(),
                        totalValueLockedInUSD: totalValueLockedInUSD.toString(),
                    };
                    response.push(poolObj);
                })
            );
        }

        // send response
        res.send(response);
    });
});

// v3 fantom
app.get("/v3/fantom/pools", (req, res) => {
    const query = gql`
        {
            dpools {
                id
                address
                stablecoin
                totalDeposit
                oneYearInterestRate
                poolDepositorRewardMintMultiplier
            }
        }
    `;

    request(graphqlEndpointFantom, query).then(async (data) => {
        const dpools = data.dpools;
        const response = [];
        if (dpools) {
            const mphPriceUSD = await getMPHPriceUSD();
            await Promise.all(
                dpools.map(async (pool) => {
                    const poolInfo = getPoolInfoFromAddress(pool.address, "fantom");

                    // get MPH APY
                    const stablecoinPrice = await getTokenPriceUSD(
                        pool.stablecoin,
                        "fantom"
                    );
                    const mphDepositorRewardMintMultiplier = new BigNumber(
                        pool.poolDepositorRewardMintMultiplier
                    );
                    const mphAPY = mphDepositorRewardMintMultiplier
                        .times(mphPriceUSD)
                        .times(YEAR_IN_SEC)
                        .div(stablecoinPrice)
                        .times(100);

                    const totalValueLockedInToken = new BigNumber(
                        pool.totalDeposit
                    );
                    const totalValueLockedInUSD =
                        totalValueLockedInToken.times(stablecoinPrice);

                    const poolObj = {
                        address: pool.address,
                        token: pool.stablecoin,
                        tokenSymbol: poolInfo.stablecoinSymbol,
                        protocol: poolInfo.protocol,
                        oneYearInterestRate: new BigNumber(
                            pool.oneYearInterestRate
                        )
                            .times(100)
                            .toString(),
                        mphAPY: mphAPY.toString(),
                        totalValueLockedInToken:
                            totalValueLockedInToken.toString(),
                        totalValueLockedInUSD: totalValueLockedInUSD.toString(),
                    };
                    response.push(poolObj);
                })
            );
        }

        // send response
        res.send(response);
    });
});

// v3 polygon
app.get("/v3/poylgon/pools", (req, res) => {
    const query = gql`
        {
            dpools {
                id
                address
                stablecoin
                totalDeposit
                oneYearInterestRate
                poolDepositorRewardMintMultiplier
            }
        }
    `;

    request(graphqlEndpointPolygon, query).then(async (data) => {
        const dpools = data.dpools;
        const response = [];
        if (dpools) {
            const mphPriceUSD = await getMPHPriceUSD();
            await Promise.all(
                dpools.map(async (pool) => {
                    const poolInfo = getPoolInfoFromAddress(pool.address, "polygon");

                    // get MPH APY
                    const stablecoinPrice = await getTokenPriceUSD(
                        pool.stablecoin,
                        "polygon-pos"
                    );
                    const mphDepositorRewardMintMultiplier = new BigNumber(
                        pool.poolDepositorRewardMintMultiplier
                    );
                    const mphAPY = mphDepositorRewardMintMultiplier
                        .times(mphPriceUSD)
                        .times(YEAR_IN_SEC)
                        .div(stablecoinPrice)
                        .times(100);

                    const totalValueLockedInToken = new BigNumber(
                        pool.totalDeposit
                    );
                    const totalValueLockedInUSD =
                        totalValueLockedInToken.times(stablecoinPrice);

                    const poolObj = {
                        address: pool.address,
                        token: pool.stablecoin,
                        tokenSymbol: poolInfo.stablecoinSymbol,
                        protocol: poolInfo.protocol,
                        oneYearInterestRate: new BigNumber(
                            pool.oneYearInterestRate
                        )
                            .times(100)
                            .toString(),
                        mphAPY: mphAPY.toString(),
                        totalValueLockedInToken:
                            totalValueLockedInToken.toString(),
                        totalValueLockedInUSD: totalValueLockedInUSD.toString(),
                    };
                    response.push(poolObj);
                })
            );
        }

        // send response
        res.send(response);
    });
});

// start the Express server
const httpServer = http.createServer(app);

const port = process.env.PORT;
httpServer.listen(port);
