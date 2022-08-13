import { getGaminGlobalClient, uploadGarminActivity } from './garmin_gobal';
import {
    GARMIN_MIGRATE_NUM_DEFAULT,
    GARMIN_MIGRATE_START_DEFAULT,
    GARMIN_PASSWORD_DEFAULT,
    GARMIN_URL_DEFAULT,
    GARMIN_USERNAME_DEFAULT,
} from '../constant';

const { GarminConnect } = require('@gooin/garmin-connect-cn');
const { GarminConnect: GarminConnectGlobal } = require('@gooin/garmin-connect');
const core = require('@actions/core');
const _ = require('lodash');
const fs = require('fs');
const unzipper = require('unzipper');
export const downloadDir = './garmin_fit_files';

const GARMIN_USERNAME = process.env.GARMIN_USERNAME ?? GARMIN_USERNAME_DEFAULT;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? GARMIN_PASSWORD_DEFAULT;
const GARMIN_MIGRATE_NUM = process.env.GARMIN_MIGRATE_NUM ?? GARMIN_MIGRATE_NUM_DEFAULT;
const GARMIN_MIGRATE_START = process.env.GARMIN_MIGRATE_START ?? GARMIN_MIGRATE_START_DEFAULT;

export const getGarminStatistics = async () => {
    const GCClient = new GarminConnect();
// Uses credentials from garmin.config.json or uses supplied params
    await GCClient.login(GARMIN_USERNAME, GARMIN_PASSWORD);
    const userInfo = await GCClient.getUserInfo();
    // console.log('userInfo', userInfo);

    // Get a list of default length with most recent activities
    const acts = await GCClient.getActivities(0, 10);
    // console.log('acts', acts);
    const recentRunningAct = _.filter(acts, { activityType: { typeKey: 'running' } })[0];
    // console.log('recentRunningAct', recentRunningAct);

    const {
        activityId, // 活动id
        activityName, // 活动名称
        startTimeLocal, // 活动开始时间
        distance, // 距离
        duration, // 时间
        averageSpeed, // 平均速度 m/s
        averageHR, // 平均心率
        maxHR, // 最大心率
        averageRunningCadenceInStepsPerMinute, // 平均每分钟步频
        aerobicTrainingEffect, // 有氧效果
        anaerobicTrainingEffect, // 无氧效果
        avgGroundContactTime, // 触地时间
        avgStrideLength, // 步幅
        vO2MaxValue, // VO2Max
        avgVerticalOscillation, // 垂直振幅
        avgVerticalRatio, // 垂直振幅比
        avgGroundContactBalance, // 触地平衡
        trainingEffectLabel, // 训练效果
        activityTrainingLoad, // 训练负荷
    } = recentRunningAct;

    const pace = 1 / (averageSpeed / 1000 * 60);
    const pace_min = Math.floor(1 / (averageSpeed / 1000 * 60));
    const pace_second = (pace - pace_min) * 60;
    // console.log('pace', pace);
    // console.log('pace_min', pace_min);
    // console.log('pace_second', pace_second);

    return {
        activityId, // 活动id
        activityName, // 活动名称
        startTimeLocal, // 活动开始时间
        distance, // 距离
        duration, // 持续时间
        // averageSpeed 是 m/s
        averageSpeed, // 速度
        averagePace: pace,  // min/km
        averagePaceText: `${pace_min}:${pace_second.toFixed(0)}`,  // min/km
        averageHR, // 平均心率
        maxHR, // 最大心率
        averageRunningCadenceInStepsPerMinute, // 平均每分钟步频
        aerobicTrainingEffect, // 有氧效果
        anaerobicTrainingEffect, // 无氧效果
        avgGroundContactTime, // 触地时间
        avgStrideLength, // 步幅
        vO2MaxValue, // 最大摄氧量
        avgVerticalOscillation, // 垂直振幅
        avgVerticalRatio, // 垂直振幅比
        avgGroundContactBalance, // 触地平衡
        trainingEffectLabel, // 训练效果
        activityTrainingLoad, // 训练负荷
        activityURL: GARMIN_URL_DEFAULT.ACTIVITY_URL + activityId, // 活动链接
    };
    // const detail = await GCClient.getActivity(recentRunningAct);
    // console.log('detail', detail);
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
        await GCClient.login(GARMIN_USERNAME, GARMIN_PASSWORD);
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
    const gpxFilePath = `${downloadDir}/${activityId}_ACTIVITY.gpx`;
    try {
        if (fs.existsSync(fitFilePath)) {
            console.log('saved fitFilePath', fitFilePath);
            //file exists
            return fitFilePath;
        }
        else if (fs.existsSync(gpxFilePath)) {
            console.log('saved gpxFilePath', gpxFilePath);
            //file exists
            return gpxFilePath;
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

export const getGaminCNClient = async () => {
    const GCClient = new GarminConnect();
// Uses credentials from garmin.config.json or uses supplied params
    await GCClient.login(GARMIN_USERNAME, GARMIN_PASSWORD);
    const userInfo = await GCClient.getUserInfo();
    console.log('userInfo cn', userInfo);
    return GCClient;
};

export const migrateGarminCN2GarminGlobal = async (count = 200) => {
    const waitTime = 2000; //ms
    const actIndex = Number(GARMIN_MIGRATE_START) ?? 0;
    // const actPerGroup = 10;
    const totalAct = Number(GARMIN_MIGRATE_NUM) ?? count;

    const GCClient = await getGaminCNClient();
    const GCClientGlobal = await getGaminGlobalClient();

    const actSlices = await GCClient.getActivities(actIndex, totalAct);
    // only running
    // const runningActs = _.filter(actSlices, { activityType: { typeKey: 'running' } });

    const runningActs = actSlices;
    for (let j = 0; j < runningActs.length; j++) {
        const act = runningActs[j];
        // console.log({ act });

        // 下载佳明原始数据
        const filePath = await downloadGarminActivity(act.activityId, GCClient);
        // 上传到佳明国际区
        console.log(`本次开始向国际区上传第 ${j} 条数据，相对总数上传到 ${j + actIndex} 条，  【 ${act.activityName} 】，开始于 【 ${act.startTimeLocal} 】，活动ID: 【 ${act.activityId} 】`);
        await uploadGarminActivity(filePath, GCClientGlobal);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
};

export const syncGarminCN2GarminGlobal = async () => {

    const GCClient = await getGaminCNClient();
    const GCClientGlobal = await getGaminGlobalClient();

    const cnActs = await GCClient.getActivities(0, 10);
    const globalActs = await GCClientGlobal.getActivities(0, 1);

    const latestGlobalActStartTime = globalActs[0].startTimeLocal;
    const latestCnActStartTime = cnActs[0].startTimeLocal;

    if (latestCnActStartTime === latestGlobalActStartTime) {
        console.log(`没有要同步的活动内容, 最近的活动:  【 ${cnActs[0].activityName} 】, 开始于: 【 ${latestCnActStartTime} 】`);
    } else {
        for (let i = 0; i < cnActs.length; i++) {
            const cnAct = cnActs[i];
            if (cnAct.startTimeLocal > latestGlobalActStartTime) {
                // 下载佳明原始数据
                const filePath = await downloadGarminActivity(cnAct.activityId, GCClient);
                // 上传到佳明国际区
                console.log(`本次开始上传第 ${i} 条数据，【 ${cnAct.activityName} 】，开始于 【 ${cnAct.startTimeLocal} 】，活动ID: 【 ${cnAct.activityId} 】`);
                await uploadGarminActivity(filePath, GCClientGlobal);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
};
