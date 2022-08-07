import { BARK_KEY_DEFAULT } from './constant';
import { getLatestActivityIdInSheets, insertDataToSheets } from './utils/google_sheets';
import { getGarminStatistics } from './utils/garmin_cn';
import { getRQOverView } from './utils/runningquotient';

const axios = require('axios');
const core = require('@actions/core');
const _ = require('lodash');

const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

export const run = async () => {
    const rqResult = await getRQOverView();
    const garminStatistics = await getGarminStatistics();
    const activityId = garminStatistics.activityId;
    const data = _.assign(rqResult, garminStatistics);
    console.log('update all data', data);
    const finalResult = _.values(data);
    const latestActivityIdInSheets = await getLatestActivityIdInSheets();
    if (latestActivityIdInSheets === String(activityId)) {
        console.log('=== 没有需要更新的数据！，快去跑步！===');
    } else {
        await insertDataToSheets(finalResult);
    }
};

try {
    run();
} catch (e) {
    axios.get(
        `https://api.day.app/${BARK_KEY}/同步数据运行失败了，快去检查！/${e.message}`);
    core.setFailed(e.message);
    throw new Error(e);
}




