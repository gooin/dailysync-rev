import {
    GARMIN_GLOBAL_PASSWORD_DEFAULT,
    GARMIN_GLOBAL_USERNAME_DEFAULT,
    GARMIN_MIGRATE_NUM_DEFAULT,
    GARMIN_MIGRATE_START_DEFAULT,
} from '../constant';
import { getGaminCNClient } from './garmin_cn';
import { GarminClientType } from './type';
import { downloadGarminActivity, uploadGarminActivity } from './garmin_common';
import { number2capital } from './number_tricks';
import core from '@actions/core';
import _ from 'lodash';

const { GarminConnect } = require('@gooin/garmin-connect');

const GARMIN_GLOBAL_USERNAME = process.env.GARMIN_GLOBAL_USERNAME ?? GARMIN_GLOBAL_USERNAME_DEFAULT;
const GARMIN_GLOBAL_PASSWORD = process.env.GARMIN_GLOBAL_PASSWORD ?? GARMIN_GLOBAL_PASSWORD_DEFAULT;
const GARMIN_MIGRATE_NUM = process.env.GARMIN_MIGRATE_NUM ?? GARMIN_MIGRATE_NUM_DEFAULT;
const GARMIN_MIGRATE_START = process.env.GARMIN_MIGRATE_START ?? GARMIN_MIGRATE_START_DEFAULT;

export const getGaminGlobalClient = async (): Promise<GarminClientType> => {
    const GCClient = new GarminConnect();
    try {
        await GCClient.login(GARMIN_GLOBAL_USERNAME, GARMIN_GLOBAL_PASSWORD);
        const userInfo = await GCClient.getUserInfo();
        const { username, emailAddress, locale } = userInfo;
        console.log('Garmin userInfo global', { username, emailAddress, locale });
        return GCClient;
    } catch (err) {
        console.error(err);
        core.setFailed(err);
    }
};

export const migrateGarminGlobal2GarminCN = async (count = 200) => {
    const actIndex = Number(GARMIN_MIGRATE_START) ?? 0;
    // const actPerGroup = 10;
    const totalAct = Number(GARMIN_MIGRATE_NUM) ?? count;

    const clientCn = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    // 从佳明国际区读取活动数据
    const actSlices = await clientGlobal.getActivities(actIndex, totalAct);
    // only running
    // const runningActs = _.filter(actSlices, { activityType: { typeKey: 'running' } });

    const runningActs = actSlices;
    for (let j = 0; j < runningActs.length; j++) {
        const act = runningActs[j];
        // 下载佳明原始数据
        const filePath = await downloadGarminActivity(act.activityId, clientGlobal);
        // 上传到佳明中国区
        console.log(`本次开始向中国区上传第 ${number2capital(j + 1)} 条数据，相对总数上传到 ${number2capital(j + 1 + actIndex)} 条，  【 ${act.activityName} 】，开始于 【 ${act.startTimeLocal} 】，活动ID: 【 ${act.activityId} 】`);
        await uploadGarminActivity(filePath, clientCn);
        // 等待2秒，避免API请求太过频繁
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
};

export const syncGarminGlobal2GarminCN = async () => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    const cnActs = await clientCN.getActivities(0, 1);
    let globalActs = await clientGlobal.getActivities(0, 10);

    const latestGlobalActStartTime = globalActs[0]?.startTimeLocal ?? '0';
    const latestCnActStartTime = cnActs[0]?.startTimeLocal ?? '0';

    if (latestCnActStartTime === latestGlobalActStartTime) {
        console.log(`没有要同步的活动内容, 最近的活动:  【 ${globalActs[0]?.activityName} 】, 开始于: 【 ${latestGlobalActStartTime} 】`);
    } else {
        // fix: #18
        _.reverse(globalActs);
        let actualNewActivityCount = 1;
        for (let i = 0; i < globalActs.length; i++) {
            const globalAct = globalActs[i];
            if (globalAct.startTimeLocal > latestCnActStartTime) {
                // 下载佳明原始数据
                const filePath = await downloadGarminActivity(globalAct.activityId, clientGlobal);
                // 上传到佳明中国区的
                console.log(`本次开始向中国区上传第 ${number2capital(actualNewActivityCount)} 条数据，【 ${globalAct.activityName} 】，开始于 【 ${globalAct.startTimeLocal} 】，活动ID: 【 ${globalAct.activityId} 】`);
                await uploadGarminActivity(filePath, clientCN);
                await new Promise(resolve => setTimeout(resolve, 1000));
                actualNewActivityCount++;
            }
        }
    }
};
