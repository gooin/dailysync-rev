import { BARK_KEY_DEFAULT } from './constant';
import { getGaminCNClient } from './utils/garmin_cn';
import { getGaminGlobalClient } from './utils/garmin_global';
import { migrateGarminWellnessByDateRange } from './utils/garmin_wellness';

const axios = require('axios');
const core = require('@actions/core');
const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

const main = async () => {
    try {
        const clientCN = await getGaminCNClient();
        const clientGlobal = await getGaminGlobalClient();
        await migrateGarminWellnessByDateRange(clientCN, clientGlobal);
    } catch (e) {
        axios.get(
            `https://api.day.app/${BARK_KEY}/Garmin CN -> Garmin Global Wellness 迁移数据运行失败了，快去检查！/${e.message}`);
        core.setFailed(e.message);
        throw new Error(e);
    }
};

main();
