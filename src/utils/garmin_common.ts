import fs from 'fs';

import {
    DOWNLOAD_DIR,
    GARMIN_URL_DEFAULT,
} from '../constant';
import { GarminClientType } from './type';
import _ from 'lodash';
const decompress = require('decompress');

/**
 * 上传 .fit file
 * @param fitFilePath
 * @param client
 */
export const uploadGarminActivity = async (fitFilePath: string, client: GarminClientType): Promise<{ status: 'uploaded' | 'duplicate' | 'error'; error?: any }> => {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR);
    }
    // @gooin/garmin-connect 的 HttpClient.handleHttpError 在抛错前会 console.error 完整响应体
    // （409 时 data 是几 KB 的 JSON），这里临时接管 console.error 把这类内部日志吞掉，只留我们自己的简短日志
    const originalConsoleError = console.error;
    console.error = ((...args: any[]) => {
        if (String(args?.[0]).startsWith('HTTP Error')) {
            return;
        }
        originalConsoleError(...args);
    }) as typeof console.error;
    try {
        await client.uploadActivity(fitFilePath);
        return { status: 'uploaded' };
    } catch (error) {
        // 409 + Duplicate Activity 说明该活动对方服务器已存在（重复迁移/同步时的正常情况），跳过即可
        const errDetail = String(error?.response?.data ?? error?.data ?? error);
        if (error?.message?.includes('409') || errDetail.includes('Duplicate Activity')) {
            return { status: 'duplicate' };
        }
        return { status: 'error', error };
    } finally {
        console.error = originalConsoleError;
    }
};

let lastProgressLogAt = 0;

/**
 * 进度展示：页尾或每 60 秒心跳打一行普通日志，任何日志介质（终端/docker logs/CI/文件）行为一致
 */
export const printMigrationProgress = (
    processed: number,
    total: number,
    act: { activityName?: string; startTimeLocal?: string; activityId?: string | number },
    status?: 'uploaded' | 'duplicate' | 'error',
    logLine = false,
) => {
    const pct = Math.min(100, total > 0 ? Math.round((processed / total) * 100) : 100);
    const barLen = 20;
    const filled = Math.min(barLen, total > 0 ? Math.round((processed / total) * barLen) : barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    const STATUS_TEXT: Record<string, string> = { uploaded: '✓ 已上传', duplicate: '⏭ 重复跳过', error: '✗ 失败' };
    const statusText = status ? STATUS_TEXT[status] ?? '' : '';
    const line = `[迁移进度] ${bar} ${processed}/${total} (${pct}%) ${statusText} 当前: 【${act?.activityName}】 ${act?.startTimeLocal} 活动ID: ${act?.activityId}`;
    // 不用 \r 原地刷新：docker logs / 日志面板等介质会把 \r 拆成碎片行。
    // 改为普通行：页尾（logLine=true）打一行；页面耗时较长时每 60 秒心跳一行。
    if (logLine || Date.now() - lastProgressLogAt >= 60000) {
        console.log(line);
        lastProgressLogAt = Date.now();
    }
};

/**
 * 下载 garmin 活动原始数据，并解压保存到本地
 * @param activityId
 * @param client GarminClientType
 */
export const downloadGarminActivity = async (activityId, client: GarminClientType): Promise<string> => {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR);
    }
    const activity = await client.getActivity({ activityId: activityId });
    await client.downloadOriginalActivityData(activity, DOWNLOAD_DIR);
    const originZipFile = DOWNLOAD_DIR + '/' + activityId + '.zip';
    const baseFilePath = `${DOWNLOAD_DIR}/`;
    const unzipped = await decompress(originZipFile, DOWNLOAD_DIR);
    const unzippedFileName = unzipped?.[0].path;
    const path = baseFilePath + unzippedFileName;
    console.log('downloadGarminActivity - path:', path)
    return path;
};

export const getGarminStatistics = async (client: GarminClientType): Promise<Record<string, any>> => {
    // Get a list of default length with most recent activities
    const acts = await client.getActivities(0, 10);
    // console.log('acts', acts);

    //  跑步 typeKey: 'running'
    //  操场跑步 typeKey: 'track_running'
    //  跑步机跑步 typeKey: 'treadmill_running'
    //  沿街跑步 typeKey: 'street_running'

    // 包含running关键字的都算
    const recentRunningAct = _.filter(acts, act => act?.activityType?.typeKey?.includes('running'))[0];
    console.log('recentRunningAct type: ', recentRunningAct.activityType?.typeKey);

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
    // 秒数小于10前面添加0， 如01，避免谷歌表格识别不成分钟数。  5:9 -> 5:09
    const pace_second_text = pace_second < 10 ? '0' + pace_second.toFixed(0) : pace_second.toFixed(0);
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
        averagePaceText: `${pace_min}:${pace_second_text}`,  // min/km
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
