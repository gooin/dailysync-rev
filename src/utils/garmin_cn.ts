import { getGaminGlobalClient } from './garmin_global';
import {
    AESKEY_DEFAULT,
    GARMIN_MIGRATE_NUM_DEFAULT,
    GARMIN_MIGRATE_START_DEFAULT,
    GARMIN_PASSWORD_DEFAULT,
    GARMIN_USERNAME_DEFAULT,
    GARMIN_SYNC_NUM_DEFAULT
} from '../constant';
import { downloadGarminActivity, printMigrationProgress, uploadGarminActivity } from './garmin_common';
import { logMigrationFailure, MIGRATE_CN2GLOBAL_LOG_NAME } from './migration_logger';
import { GarminClientType } from './type';
import { number2capital, toSafeInt } from './number_tricks';
const core = require('@actions/core');
import _ from 'lodash';
import { getSessionFromDB, initDB, saveSessionToDB, updateSessionToDB } from './sqlite';
import { getSessionFromEnv } from './garmin_session_env';

const CryptoJS = require('crypto-js');
const fs = require('fs');

const { GarminConnect } = require('@gooin/garmin-connect');

const GARMIN_USERNAME = process.env.GARMIN_USERNAME ?? GARMIN_USERNAME_DEFAULT;
const GARMIN_PASSWORD = process.env.GARMIN_PASSWORD ?? GARMIN_PASSWORD_DEFAULT;
const GARMIN_MIGRATE_NUM = process.env.GARMIN_MIGRATE_NUM ?? GARMIN_MIGRATE_NUM_DEFAULT;
const GARMIN_MIGRATE_START = process.env.GARMIN_MIGRATE_START ?? GARMIN_MIGRATE_START_DEFAULT;
const GARMIN_SYNC_NUM = process.env.GARMIN_SYNC_NUM ?? GARMIN_SYNC_NUM_DEFAULT;
// 自动翻页开关：GARMIN_MIGRATE_AUTO_PAGE=0 时只跑一批（从 GARMIN_MIGRATE_START 开始、数量 GARMIN_MIGRATE_NUM），方便调试
const AUTO_PAGE_ENABLED = !['0', 'false', 'off'].includes(String(process.env.GARMIN_MIGRATE_AUTO_PAGE ?? '').toLowerCase());

export const getGaminCNClient = async (): Promise<GarminClientType> => {
    if (_.isEmpty(GARMIN_USERNAME) || _.isEmpty(GARMIN_PASSWORD)) {
        const errMsg = '请填写中国区用户名及密码：GARMIN_USERNAME,GARMIN_PASSWORD';
        core.setFailed(errMsg);
        return Promise.reject(errMsg);
    }

    const GCClient = new GarminConnect({username: GARMIN_USERNAME, password: GARMIN_PASSWORD}, 'garmin.cn');

    try {
        await initDB();

        const envSession = getSessionFromEnv('CN');
        if (envSession) {
            console.log('GarminCN: login by env session');
            await GCClient.loadToken(envSession.oauth1, envSession.oauth2);
            const currentSession = await getSessionFromDB('CN');
            if (currentSession) {
                await updateSessionToDB('CN', GCClient.exportToken());
            } else {
                await saveSessionToDB('CN', GCClient.exportToken());
            }
        } else {
            const currentSession = await getSessionFromDB('CN');
            if (!currentSession) {
                await GCClient.login();
                await saveSessionToDB('CN', GCClient.exportToken());
            } else {
                //  Wrap error message in GCClient, prevent terminate in github actions.
                try {
                    console.log('GarminCN: login by saved session');
                    await GCClient.loadToken(currentSession.oauth1, currentSession.oauth2);
                } catch (e) {
                    console.log('Warn: renew  GarminCN Session..');
                    await GCClient.login(GARMIN_USERNAME, GARMIN_PASSWORD);
                    await updateSessionToDB('CN', GCClient.exportToken());
                }

            }
        }

        const userInfo = await GCClient.getUserProfile();
        const { fullName, userName: emailAddress, location } = userInfo;
        if (!fullName) {
            throw Error('佳明中国区登录失败')
        }
        console.log('Garmin userInfo CN: ', { fullName, emailAddress, location });

        return GCClient;
    } catch (err) {
        console.error(err);
        core.setFailed(err);
    }
};

export const migrateGarminCN2GarminGlobal = async (count = 200) => {
    // GARMIN_MIGRATE_NUM 作为每页条数，GARMIN_MIGRATE_START 作为起始偏移
    const batchSize = toSafeInt(GARMIN_MIGRATE_NUM, count);
    const startOffset = toSafeInt(GARMIN_MIGRATE_START, 0);

    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();
    if (!clientCN || !clientGlobal) {
        throw new Error('佳明登录失败，无法开始迁移');
    }

    // 先拉一次全量列表拿总数用于进度展示（该接口对 limit 不截断，999 足够大）
    const totalActs = await clientCN.getActivities(startOffset, 999);
    const totalCount = totalActs?.length ?? 0;
    if (totalCount === 0) {
        console.log('国区没有待迁移的活动');
        return;
    }
    // 预先拉取国际区已有活动用于快速查重：重复的直接跳过，不再下载+上传（全量重复时整个校验只需几秒）
    // 查重键用 开始时间|取整时长：两侧 activityName 语言不同（CN 中文 / Global 英文），不能拿活动名比对
    const globalExisting = await clientGlobal.getActivities(0, 999);
    const existingKeys = new Set<string>((globalExisting ?? []).map((a: any) => `${a.startTimeLocal}|${Math.round(a.duration ?? 0)}`));
    const preDupCount = totalActs.filter((a: any) => existingKeys.has(`${a.startTimeLocal}|${Math.round(a.duration ?? 0)}`)).length;
    const modeNote = AUTO_PAGE_ENABLED ? '' : `（单批调试模式：仅处理从 ${startOffset} 起的 ${batchSize} 条）`;
    console.log(`国区待迁移活动共 ${totalCount} 条，其中重复跳过 ${preDupCount} 条，需上传 ${totalCount - preDupCount} 条，预计耗时 ${Math.round(((totalCount - preDupCount) * 4) / 60)}~${Math.round(((totalCount - preDupCount) * 6) / 60)} 分钟${modeNote}`);

    let pageIndex = startOffset;
    let processedTotal = 0;
    let uploadedCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    // 防止接口异常时死循环：自动翻页最多 500 页；关闭自动翻页时只跑一批
    const MAX_PAGES = AUTO_PAGE_ENABLED ? 500 : 1;
    for (let page = 0; page < MAX_PAGES; page++) {
        const actSlices = await clientCN.getActivities(pageIndex, batchSize);
        if (!actSlices || actSlices.length === 0) {
            break;
        }

        for (let j = 0; j < actSlices.length; j++) {
            const act = actSlices[j];
            const actKey = `${act.startTimeLocal}|${Math.round(act.duration ?? 0)}`;
            if (existingKeys.has(actKey)) {
                // 国际区已存在同时间+同时长的活动，直接跳过（不下载不上传）
                processedTotal++;
                duplicateCount++;
                printMigrationProgress(processedTotal, totalCount, act, 'duplicate');
                continue;
            }
            // 下载佳明原始数据
            const filePath = await downloadGarminActivity(act.activityId, clientCN);
            // 上传到佳明国际区
            const { status, error } = await uploadGarminActivity(filePath, clientGlobal);
            processedTotal++;
            if (status === 'uploaded') {
                uploadedCount++;
                existingKeys.add(actKey); // 本次上传成功，纳入查重集合，避免源列表内重复条目二次上传
            } else if (status === 'duplicate') {
                duplicateCount++;
            } else {
                failedCount++;
                logMigrationFailure(MIGRATE_CN2GLOBAL_LOG_NAME, `上传失败: 【${act.activityName}】 ${act.startTimeLocal} 活动ID: ${act.activityId} 文件: ${filePath} 错误: ${error?.message ?? error}`);
                // 非 TTY 模式进度条静默，失败条目单独打印保证可见
                console.log(`上传失败: 【${act.activityName}】 ${act.startTimeLocal} 活动ID: ${act.activityId} 错误: ${error?.message ?? error}`);
            }
            printMigrationProgress(processedTotal, totalCount, act, status, j === actSlices.length - 1);
        }

        pageIndex += actSlices.length;
        // 取到的数量不足一页，说明已到最早一条活动
        if (actSlices.length < batchSize) {
            break;
        }
    }
    console.log(`迁移结束：共处理 ${processedTotal} 条（成功 ${uploadedCount}，重复跳过 ${duplicateCount}，失败 ${failedCount}），失败明细见 log/${MIGRATE_CN2GLOBAL_LOG_NAME}_*_failed.log`);
};

export const syncGarminCN2GarminGlobal = async () => {
    const clientCN = await getGaminCNClient();
    const clientGlobal = await getGaminGlobalClient();

    let cnActs = await clientCN.getActivities(0, Number(GARMIN_SYNC_NUM));
    const globalActs = await clientGlobal.getActivities(0, 1);

    const latestGlobalActStartTime = globalActs[0]?.startTimeLocal ?? '0';
    const latestCnActStartTime = cnActs[0]?.startTimeLocal ?? '0';
    if (latestCnActStartTime === latestGlobalActStartTime) {
        console.log(`没有要同步的活动内容, 最近的活动:  【 ${cnActs[0].activityName} 】, 开始于: 【 ${latestCnActStartTime} 】`);
    } else {
        // fix: #18
        _.reverse(cnActs);
        let actualNewActivityCount = 1;
        for (let i = 0; i < cnActs.length; i++) {
            const cnAct = cnActs[i];
            if (cnAct.startTimeLocal > latestGlobalActStartTime) {
                // 下载佳明原始数据
                const filePath = await downloadGarminActivity(cnAct.activityId, clientCN);
                // 上传到佳明国际区
                console.log(`本次开始向国际区上传第 ${number2capital(actualNewActivityCount)} 条数据，【 ${cnAct.activityName} 】，开始于 【 ${cnAct.startTimeLocal} 】，活动ID: 【 ${cnAct.activityId} 】`);
                await uploadGarminActivity(filePath, clientGlobal);
                await new Promise(resolve => setTimeout(resolve, 1000));
                actualNewActivityCount++;
            }
        }
    }
};
