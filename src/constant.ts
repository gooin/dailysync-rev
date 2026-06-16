import fs from 'fs';
import path from 'path';

const loadDotEnv = (): void => {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
        return;
    }

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmedLine.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const name = trimmedLine.slice(0, separatorIndex).trim();
        let value = trimmedLine.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (process.env[name] === undefined) {
            process.env[name] = value;
        }
    }
};

loadDotEnv();

const envOrDefault = (name: string, defaultValue: string): string => {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        return defaultValue;
    }

    return value;
};

export const FILE_SUFFIX = {
    FIT: 'fit',
    GPX: 'gpx',
    TCX: 'tcx',
};
export const DOWNLOAD_DIR = './garmin_fit_files';
export const WELLNESS_DOWNLOAD_DIR = './garmin_wellness_files';
export const DB_FILE_PATH = './db/garmin.db';
export const AESKEY_DEFAULT = 'LSKDAJALSD';
/**
 * GARMIN ACCOUNT
 */
// 佳明中国区账号及密码
export const GARMIN_USERNAME_DEFAULT = envOrDefault('GARMIN_USERNAME_DEFAULT', '');
export const GARMIN_PASSWORD_DEFAULT = envOrDefault('GARMIN_PASSWORD_DEFAULT', '');
// 佳明国际区区账号及密码
export const GARMIN_GLOBAL_USERNAME_DEFAULT = envOrDefault('GARMIN_GLOBAL_USERNAME_DEFAULT', '');
export const GARMIN_GLOBAL_PASSWORD_DEFAULT = envOrDefault('GARMIN_GLOBAL_PASSWORD_DEFAULT', '');
// 佳明迁移数量配置
export const GARMIN_MIGRATE_NUM_DEFAULT = envOrDefault('GARMIN_MIGRATE_NUM_DEFAULT', '');
export const GARMIN_MIGRATE_START_DEFAULT = envOrDefault('GARMIN_MIGRATE_START_DEFAULT', '');
// 佳明每次同步时检查的最多的数量
export const GARMIN_SYNC_NUM_DEFAULT = 10;
export const GARMIN_SYNC_WELLNESS_DEFAULT = envOrDefault('GARMIN_SYNC_WELLNESS_DEFAULT', 'false');
export const GARMIN_WELLNESS_SYNC_DAYS_DEFAULT = envOrDefault('GARMIN_WELLNESS_SYNC_DAYS_DEFAULT', '');
// 佳明迁移时检查的天数范围
export const GARMIN_WELLNESS_MIGRATE_DAYS_DEFAULT = envOrDefault('GARMIN_WELLNESS_MIGRATE_DAYS_DEFAULT', '');
export const GARMIN_WELLNESS_MIGRATE_START_DAYS_DEFAULT = envOrDefault('GARMIN_WELLNESS_MIGRATE_START_DAYS_DEFAULT', '');

export const GARMIN_URL_DEFAULT = {
    'BASE_URL': 'https://connect.garmin.cn',
    'ACTIVITY_URL': 'https://connect.garmin.cn/modern/activity/',
    'SSO_URL_ORIGIN': 'https://sso.garmin.com',
    'SSO_URL': 'https://sso.garmin.cn/sso',
    'MODERN_URL': 'https://connect.garmin.cn/modern',
    'SIGNIN_URL': 'https://sso.garmin.cn/sso/signin',
    'CSS_URL': 'https://static.garmincdn.cn/cn.garmin.connect/ui/css/gauth-custom-v1.2-min.css',
};

/**
 * GOOGLE ACCOUNT
 */
export const GOOGLE_API_CLIENT_EMAIL_DEFAULT = '';
export const GOOGLE_API_PRIVATE_KEY_DEFAULT = '';
export const GOOGLE_SHEET_ID_DEFAULT = '';

/**
 * RQ ACCOUNT
 */
export const RQ_USERID_DEFAULT = '';
export const RQ_COOKIE_DEFAULT = '';
export const RQ_CSRF_TOKEN_DEFAULT = '';
export const RQ_USERNAME_DEFAULT = '';
export const RQ_PASSWORD_DEFAULT = '';
export const RQ_HOST_DEFAULT = 'https://www.runningquotient.cn/';
export const UA_DEFAULT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36';
export const RQ_ROUTES_DEFAULT = {
    LOGIN: '/user/login',
    OVERVIEW: '/training/getOverView',
    UPDATE: 'training/update-overview?userId=',
};

export const BARK_KEY_DEFAULT = '';

/**
 * STRAVA ACCOUNT
 */
export const STRAVA_ACCESS_TOKEN_DEFAULT = '';
export const STRAVA_CLIENT_ID_DEFAULT = '';
export const STRAVA_CLIENT_SECRET_DEFAULT = '';
export const STRAVA_REDIRECT_URI_DEFAULT = '';
