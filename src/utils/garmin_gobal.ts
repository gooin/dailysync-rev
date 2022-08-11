import {
    GARMIN_GLOBAL_PASSWORD_DEFAULT,
    GARMIN_GLOBAL_USERNAME_DEFAULT,
    GARMIN_MIGRATE_NUM_DEFAULT,
    GARMIN_MIGRATE_START_DEFAULT,
} from '../constant';
import fs from 'fs';
import { downloadDir, getGaminCNClient } from './garmin_cn';
import core from '@actions/core';


const unzipper = require('unzipper');

const { GarminConnect } = require('@gooin/garmin-connect');

const GARMIN_GLOBAL_USERNAME = process.env.GARMIN_GLOBAL_USERNAME ?? GARMIN_GLOBAL_USERNAME_DEFAULT;
const GARMIN_GLOBAL_PASSWORD = process.env.GARMIN_GLOBAL_PASSWORD ?? GARMIN_GLOBAL_PASSWORD_DEFAULT;
const GARMIN_MIGRATE_NUM = process.env.GARMIN_MIGRATE_NUM ?? GARMIN_MIGRATE_NUM_DEFAULT;
const GARMIN_MIGRATE_START = process.env.GARMIN_MIGRATE_START ?? GARMIN_MIGRATE_START_DEFAULT;


/**
 *  // fix: 上传功能以修正，但会报个异常，不用管可以上传上去的。
 * 上传 .fit file 到 garmin 国际区
 * @param fitFilePath
 * @param client
 */
export const uploadGarminActivity = async (fitFilePath: string, client = null): Promise<void> => {
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
    }
    let GCClient = client ?? new GarminConnect();
    if (!client) {
        await GCClient.login(GARMIN_GLOBAL_USERNAME, GARMIN_GLOBAL_PASSWORD);
        const userInfo = await GCClient.getUserInfo();
        // console.log('userInfo', userInfo);
    }
// Uses credentials from garmin.config.json or uses supplied params



    const upload = await GCClient.uploadActivity(fitFilePath);
    // const activityId = upload.detailedImportResult.successes[0].internalId;
    console.log('upload to garmin activity', upload);
    // console.log('upload to garmin global activityId', activityId);
};

export const getGaminGlobalClient = async () => {
    const GCClient = new GarminConnect();
// Uses credentials from garmin.config.json or uses supplied params
    await GCClient.login(GARMIN_GLOBAL_USERNAME, GARMIN_GLOBAL_PASSWORD);
    const userInfo = await GCClient.getUserInfo();
    console.log('userInfo global', userInfo);
    return GCClient;
};

/**
 * 下载 garmin 活动原始数据，并解压保存到本地
 * @param activityId
 * @param client clientInstance
 */
export const downloadGarminActivity = async (activityId, client = null): Promise<string> => {
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
    }
    let GCClient = client ?? new GarminConnect();
    if (!client) {
        await GCClient.login(GARMIN_GLOBAL_USERNAME, GARMIN_GLOBAL_PASSWORD);
        const userInfo = await GCClient.getUserInfo();
        // console.log('userInfo', userInfo);
    }

    // Use the id as a parameter
    const activity = await GCClient.getActivity({ activityId: activityId });
    await GCClient.downloadOriginalActivityData(activity, downloadDir);
    // console.log('userInfo', userInfo);
    const originZipFile = downloadDir + '/' + activityId + '.zip';
    await fs.createReadStream(originZipFile)
        .pipe(unzipper.Extract({ path: downloadDir }));
    // waiting 5s for extract zip file
    await new Promise(resolve => setTimeout(resolve, 5000));
    const fitFilePath = `${downloadDir}/${activityId}_ACTIVITY.fit`;
    try {
        if (fs.existsSync(fitFilePath)) {
            console.log('saved fitFilePath', fitFilePath);
            //file exists
            return fitFilePath;
        } else {
            const existFiles = fs.readdirSync(downloadDir, { withFileTypes: true })
                .filter(item => !item.isDirectory())
                .map(item => item.name);
            console.log('fitFilePath', fitFilePath);
            console.log('fitFilePath not exist, curr existFiles', existFiles);
            return Promise.reject('file not exist ' + fitFilePath);
        }
    } catch (err) {
        console.error(err);
        core.setFailed(err);
    }
    return fitFilePath;
};


export const migrateGarminGlobal2GarminCN = async (count = 200) => {
    const waitTime = 2000; //ms
    const actIndex = Number(GARMIN_MIGRATE_START) ?? 0;
    // const actPerGroup = 10;
    const totalAct = Number(GARMIN_MIGRATE_NUM) ?? count;

    const GCClient = await getGaminCNClient();
    const GCClientGlobal = await getGaminGlobalClient();

    const actSlices = await GCClientGlobal.getActivities(actIndex, totalAct);
    // only running
    // const runningActs = _.filter(actSlices, { activityType: { typeKey: 'running' } });

    const runningActs = actSlices;
    for (let j = 0; j < runningActs.length; j++) {
        const act = runningActs[j];
        // console.log({ act });

        // 下载佳明原始数据
        const filePath = await downloadGarminActivity(act.activityId, GCClientGlobal);
        // 上传到佳明中国区
        console.log(`本次开始向中国区上传第 ${j} 条数据，相对总数上传到 ${ j + actIndex } 条，  【 ${act.activityName} 】，开始于 【 ${act.startTimeLocal} 】，活动ID: 【 ${act.activityId} 】`);
        await uploadGarminActivity(filePath, GCClient);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
};

export const syncGarminGlobal2GarminCN= async () => {
    const GCClientCN = await getGaminCNClient();
    const GCClientGlobal = await getGaminGlobalClient();

    const cnActs = await GCClientCN.getActivities(0, 1);
    const globalActs = await GCClientGlobal.getActivities(0, 10);

    const latestGlobalActStartTime = globalActs[0].startTimeLocal;
    const latestCnActStartTime = cnActs[0].startTimeLocal;

    if (latestCnActStartTime === latestGlobalActStartTime) {
        console.log(`没有要同步的活动内容, 最近的活动:  【 ${globalActs[0].activityName} 】, 开始于: 【 ${latestGlobalActStartTime} 】`);
    } else {
        for (let i = 0; i < globalActs.length; i++) {
            const globalAct = globalActs[i];
            if (globalAct.startTimeLocal > latestCnActStartTime) {
                // 下载佳明原始数据
                const filePath = await downloadGarminActivity(globalAct.activityId, GCClientGlobal);
                // 上传到佳明中国区的
                console.log(`本次开始上传第 ${i} 条数据，【 ${globalAct.activityName} 】，开始于 【 ${globalAct.startTimeLocal} 】，活动ID: 【 ${globalAct.activityId} 】`);
                await uploadGarminActivity(filePath, GCClientCN);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
};
