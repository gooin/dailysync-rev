import fs from 'fs';
import path from 'path';

import {
    GARMIN_SYNC_WELLNESS_DEFAULT,
    GARMIN_WELLNESS_MIGRATE_DAYS_DEFAULT,
    GARMIN_WELLNESS_MIGRATE_START_DAYS_DEFAULT,
    GARMIN_WELLNESS_SYNC_DAYS_DEFAULT,
    WELLNESS_DOWNLOAD_DIR,
} from '../constant';
import { GarminClientType } from './type';

const decompress = require('decompress');
const FormData = require('form-data');

const envOrDefault = (name: string, defaultValue: string): string => {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        return defaultValue;
    }

    return value;
};

export type GarminWellnessUploadStatus = 'uploaded' | 'duplicate';

export type GarminWellnessUploadResult = {
    filePath: string;
    status: GarminWellnessUploadStatus;
    response?: any;
};

export type GarminWellnessSyncResult = {
    date: string;
    total: number;
    uploaded: number;
    duplicate: number;
    failed: number;
};

const GARMIN_SYNC_WELLNESS = envOrDefault('GARMIN_SYNC_WELLNESS', GARMIN_SYNC_WELLNESS_DEFAULT);
const GARMIN_WELLNESS_SYNC_DAYS = envOrDefault('GARMIN_WELLNESS_SYNC_DAYS', GARMIN_WELLNESS_SYNC_DAYS_DEFAULT);
const GARMIN_WELLNESS_MIGRATE_DAYS = envOrDefault('GARMIN_WELLNESS_MIGRATE_DAYS', GARMIN_WELLNESS_MIGRATE_DAYS_DEFAULT);
const GARMIN_WELLNESS_MIGRATE_START_DAYS = envOrDefault(
    'GARMIN_WELLNESS_MIGRATE_START_DAYS',
    GARMIN_WELLNESS_MIGRATE_START_DAYS_DEFAULT,
);

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const ensureDirectory = (dirPath: string): void => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const formatGarminDate = (date: Date): string => {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

export const getGarminDatesByOffset = (startDaysAgo: number, days: number): string[] => {
    const normalizedDays = Math.max(1, Number(days) || 1);
    const normalizedStartDaysAgo = Math.max(0, Number(startDaysAgo) || 0);
    const dates: string[] = [];

    for (let dayOffset = 0; dayOffset < normalizedDays; dayOffset++) {
        const date = new Date();
        date.setDate(date.getDate() - normalizedStartDaysAgo - dayOffset);
        dates.push(formatGarminDate(date));
    }

    return dates;
};

export const getRecentGarminDates = (days: number): string[] => getGarminDatesByOffset(0, days);

export const isGarminWellnessSyncEnabled = (): boolean => {
    const normalizedValue = GARMIN_SYNC_WELLNESS.trim().toLowerCase();
    return normalizedValue === 'true' || normalizedValue === '1';
};

export const getGarminWellnessSyncDays = (): number => {
    return Math.max(1, Number(GARMIN_WELLNESS_SYNC_DAYS) || 1);
};

export const getGarminWellnessMigrateDays = (): number => {
    return Math.max(0, Number(GARMIN_WELLNESS_MIGRATE_DAYS) || 0);
};

export const getGarminWellnessMigrateStartDays = (): number => {
    return Math.max(0, Number(GARMIN_WELLNESS_MIGRATE_START_DAYS) || 0);
};

export const downloadGarminWellnessZip = async (client: GarminClientType, date: string): Promise<string> => {
    ensureDirectory(WELLNESS_DOWNLOAD_DIR);

    const zipFilePath = path.join(WELLNESS_DOWNLOAD_DIR, `${date}.zip`);
    const url = `${client.url.GC_API}/download-service/files/wellness/${date}`;
    const data = await client.client.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(data);

    fs.writeFileSync(zipFilePath, buffer);
    console.log(`Garmin wellness: downloaded ${date} zip, bytes=${buffer.length}`);

    return zipFilePath;
};

export const extractGarminWellnessFitFiles = async (zipFilePath: string, date: string): Promise<string[]> => {
    const outputDir = path.join(WELLNESS_DOWNLOAD_DIR, date);
    ensureDirectory(outputDir);

    const entries = await decompress(zipFilePath, outputDir);
    return entries
        .map(entry => path.join(outputDir, entry.path))
        .filter(filePath => filePath.toLowerCase().endsWith('.fit'));
};

const isDuplicateWellnessFileError = (error: any): boolean => {
    const message = error?.message ?? String(error);
    return message.includes('Duplicate Wellness File') || message.includes('ERROR: (409)');
};

const isInactiveWellnessDeviceError = (error: any): boolean => {
    const message = error?.message ?? String(error);
    return message.includes('Wellness device is not active for this user') || message.includes('ERROR: (419)');
};

const logInactiveWellnessDeviceHint = (): void => {
    console.error(
        [
            'Garmin wellness: target account is not ready for wellness imports.',
            'Please manually pair or connect a Garmin device that supports health data on the target account,',
            'open Garmin Connect once, and make sure wellness data such as steps, sleep, HRV, or stress is enabled.',
        ].join(' '),
    );
};

export const uploadGarminWellnessFile = async (
    client: GarminClientType,
    filePath: string,
): Promise<GarminWellnessUploadResult> => {
    const form = new FormData();
    form.append('userfile', fs.createReadStream(filePath));

    try {
        const response = await client.client.post(`${client.url.UPLOAD}.fit`, form, {
            headers: {
                'Content-Type': form.getHeaders()['content-type'],
            },
        });

        return {
            filePath,
            status: 'uploaded',
            response,
        };
    } catch (error) {
        if (isDuplicateWellnessFileError(error)) {
        return {
            filePath,
            status: 'duplicate',
        };
    }

        if (isInactiveWellnessDeviceError(error)) {
            logInactiveWellnessDeviceHint();
        }

        throw error;
    }
};

export const syncGarminWellnessByDate = async (
    date: string,
    sourceClient: GarminClientType,
    targetClient: GarminClientType,
): Promise<GarminWellnessSyncResult> => {
    console.log(`Garmin wellness: sync ${date} start`);

    const zipFilePath = await downloadGarminWellnessZip(sourceClient, date);
    const fitFilePaths = await extractGarminWellnessFitFiles(zipFilePath, date);

    let uploaded = 0;
    let duplicate = 0;
    let failed = 0;

    for (const fitFilePath of fitFilePaths) {
        const fileName = path.basename(fitFilePath);

        try {
            const result = await uploadGarminWellnessFile(targetClient, fitFilePath);
            if (result.status === 'duplicate') {
                duplicate++;
                console.log(`Garmin wellness: duplicate ${fileName}`);
            } else {
                uploaded++;
                console.log(`Garmin wellness: uploaded ${fileName}`);
            }
        } catch (error) {
            failed++;
            console.error(`Garmin wellness: upload failed ${fileName}`, error);
        }

        await sleep(500);
    }

    console.log(
        `Garmin wellness: sync ${date} done, total=${fitFilePaths.length}, uploaded=${uploaded}, duplicate=${duplicate}, failed=${failed}`,
    );

    return {
        date,
        total: fitFilePaths.length,
        uploaded,
        duplicate,
        failed,
    };
};

export const syncGarminWellnessRecentDays = async (
    sourceClient: GarminClientType,
    targetClient: GarminClientType,
    days = getGarminWellnessSyncDays(),
    force = false,
): Promise<GarminWellnessSyncResult[]> => {
    if (!force && !isGarminWellnessSyncEnabled()) {
        console.log('Garmin wellness: disabled by GARMIN_SYNC_WELLNESS');
        return [];
    }

    const dates = getRecentGarminDates(days);
    const results: GarminWellnessSyncResult[] = [];

    for (const date of dates) {
        try {
            const result = await syncGarminWellnessByDate(date, sourceClient, targetClient);
            results.push(result);
        } catch (error) {
            console.error(`Garmin wellness: sync ${date} failed`, error);
            results.push({
                date,
                total: 0,
                uploaded: 0,
                duplicate: 0,
                failed: 1,
            });
        }
    }

    return results;
};

export const migrateGarminWellnessByDateRange = async (
    sourceClient: GarminClientType,
    targetClient: GarminClientType,
    days = getGarminWellnessMigrateDays(),
    startDaysAgo = getGarminWellnessMigrateStartDays(),
): Promise<GarminWellnessSyncResult[]> => {
    if (days <= 0) {
        console.log('Garmin wellness migrate: skipped, set GARMIN_WELLNESS_MIGRATE_DAYS to enable');
        return [];
    }

    const dates = getGarminDatesByOffset(startDaysAgo, days);
    const results: GarminWellnessSyncResult[] = [];

    console.log(
        `Garmin wellness migrate: start, days=${days}, startDaysAgo=${startDaysAgo}, first=${dates[0]}, last=${dates[dates.length - 1]}`,
    );

    for (const date of dates) {
        try {
            const result = await syncGarminWellnessByDate(date, sourceClient, targetClient);
            results.push(result);
        } catch (error) {
            console.error(`Garmin wellness migrate: sync ${date} failed`, error);
            results.push({
                date,
                total: 0,
                uploaded: 0,
                duplicate: 0,
                failed: 1,
            });
        }
    }

    return results;
};
