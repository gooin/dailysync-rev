import { getGaminGlobalClient } from './garmin_gobal';
import {
    GARMIN_MIGRATE_NUM_DEFAULT,
    GARMIN_MIGRATE_START_DEFAULT,
    GARMIN_PASSWORD_DEFAULT,
    GARMIN_USERNAME_DEFAULT,
} from '../constant';
import { downloadGarminActivity, uploadGarminActivity } from './garmin_common';
import { GarminClientType } from './type';
import { number2emoji } from './number2emoji';

const { GarminConnect } = require('@gooin/garmin-connect-cn');
export const downloadDir = './garmin_fit_files';

const GARMIN_USERNAME = process.env.GARMIN_USERNAME ?? GARMIN_USERNAME_DEFAULT;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? GARMIN_PASSWORD_DEFAULT;
const GARMIN_MIGRATE_NUM = process.env.GARMIN_MIGRATE_NUM ?? GARMIN_MIGRATE_NUM_DEFAULT;
const GARMIN_MIGRATE_START = process.env.GARMIN_MIGRATE_START ?? GARMIN_MIGRATE_START_DEFAULT;

export const getGaminCNClient = async (): Promise<GarminClientType> => {
    const GCClient = new GarminConnect();
// Uses credentials from garmin.config.json or uses supplied params
    await GCClient.login(GARMIN_USERNAME, GARMIN_PASSWORD);
    const userInfo = await GCClient.getUserInfo();
    const { username, emailAddress, locale } = userInfo;
    console.log('userInfo cn', { username, emailAddress, locale });
    return GCClient;
};

export const migrateGarminCN2GarminGlobal = async (count = 200) => {
    const actIndex = Number(GARMIN_MIGRATE_START) ?? 0;
    // const actPerGroup = 10;
    const totalAct = Number(GARMIN_MIGRATE_NUM) ?? count;

    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    const actSlices = await clientCN.getActivities(actIndex, totalAct);
    // only running
    // const runningActs = _.filter(actSlices, { activityType: { typeKey: 'running' } });

    const runningActs = actSlices;
    for (let j = 0; j < runningActs.length; j++) {
        const act = runningActs[j];
        // console.log({ act });
        // 下载佳明原始数据
        const filePath = await downloadGarminActivity(act.activityId, clientCN);
        // 上传到佳明国际区
        console.log(`本次开始向国际区上传第 ${number2emoji(j + 1)} 条数据，相对总数上传到 ${number2emoji(j + 1 + actIndex)} 条，  【 ${act.activityName} 】，开始于 【 ${act.startTimeLocal} 】，活动ID: 【 ${act.activityId} 】`);
        await uploadGarminActivity(filePath, clientGlobal);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
};

export const syncGarminCN2GarminGlobal = async () => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    const cnActs = await clientCN.getActivities(0, 10);
    const globalActs = await clientGlobal.getActivities(0, 1);

    const latestGlobalActStartTime = globalActs[0].startTimeLocal ?? '0';
    const latestCnActStartTime = cnActs[0].startTimeLocal;

    if (latestCnActStartTime === latestGlobalActStartTime) {
        console.log(`没有要同步的活动内容, 最近的活动:  【 ${cnActs[0].activityName} 】, 开始于: 【 ${latestCnActStartTime} 】`);
    } else {
        for (let i = 0; i < cnActs.length; i++) {
            const cnAct = cnActs[i];
            if (cnAct.startTimeLocal > latestGlobalActStartTime) {
                // 下载佳明原始数据
                const filePath = await downloadGarminActivity(cnAct.activityId, clientCN);
                // 上传到佳明国际区
                console.log(`本次开始向国际区上传第 ${number2emoji(i + 1)} 条数据，【 ${cnAct.activityName} 】，开始于 【 ${cnAct.startTimeLocal} 】，活动ID: 【 ${cnAct.activityId} 】`);
                await uploadGarminActivity(filePath, clientGlobal);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
};
