import { AESKEY_DEFAULT, DB_FILE_PATH, DOWNLOAD_DIR, GARMIN_USERNAME_DEFAULT } from '../constant';
import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';

const CryptoJS = require('crypto-js');

const GARMIN_USERNAME = process.env.GARMIN_USERNAME ?? GARMIN_USERNAME_DEFAULT;
const AESKEY = process.env.AESKEY ?? AESKEY_DEFAULT;

export const initDB = async () => {
    const db = await getDB();
    await db.exec(`CREATE TABLE IF NOT EXISTS garmin_session (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user VARCHAR(20),
            region VARCHAR(20),
            session  TEXT
        )`);
    // 同步游标：记录每个同步方向最后成功同步的活动开始时间，增量同步从这里继续（断点续传）
    await db.exec(`CREATE TABLE IF NOT EXISTS garmin_sync_cursor (
            direction VARCHAR(20) PRIMARY KEY,
            last_sync_start_time TEXT,
            updated_at TEXT
        )`);
};

export const getDB = async () => {
    return await open({
        filename: DB_FILE_PATH,
        driver: sqlite3.Database,
    });
};

export const saveSessionToDB = async (type: 'CN' | 'GLOBAL', session: Record<string, any>) => {
    const db = await getDB();
    const encryptedSessionStr = encryptSession(session);
    await db.run(
        `INSERT INTO garmin_session (user,region,session) VALUES (?,?,?)`,
        GARMIN_USERNAME, type, encryptedSessionStr,
    );
};

export const updateSessionToDB = async (type: 'CN' | 'GLOBAL', session: Record<string, any>) => {
    const db = await getDB();
    const encryptedSessionStr = encryptSession(session);
    await db.run(
        'UPDATE garmin_session SET session = ? WHERE user = ? AND region = ?',
        encryptedSessionStr,
        GARMIN_USERNAME,
        type,
    );
};

export const getSessionFromDB = async (type: 'CN' | 'GLOBAL'): Promise<Record<string, any> | undefined> => {
    const db = await getDB();
    const queryResult = await db.get(
        'SELECT session FROM garmin_session WHERE user = ? AND region = ? ',
        GARMIN_USERNAME, type,
    );
    if (!queryResult) {
        return undefined;
    }
    const encryptedSessionStr = queryResult?.session;
    // return {}
    return decryptSession(encryptedSessionStr);
};

export const getSyncCursor = async (direction: string): Promise<{ direction: string; lastSyncStartTime: string } | undefined> => {
    const db = await getDB();
    const queryResult = await db.get(
        'SELECT direction, last_sync_start_time FROM garmin_sync_cursor WHERE direction = ?',
        direction,
    );
    if (!queryResult) {
        return undefined;
    }
    return { direction: queryResult.direction, lastSyncStartTime: queryResult.last_sync_start_time };
};

export const setSyncCursor = async (direction: string, lastSyncStartTime: string) => {
    const db = await getDB();
    await db.run(
        `INSERT INTO garmin_sync_cursor (direction, last_sync_start_time, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(direction) DO UPDATE SET last_sync_start_time = excluded.last_sync_start_time, updated_at = excluded.updated_at`,
        direction,
        lastSyncStartTime,
    );
};

export const encryptSession = (session: Record<string, any>): string => {
    const sessionStr = JSON.stringify(session);
    return CryptoJS.AES.encrypt(sessionStr, AESKEY).toString();
};
export const decryptSession = (sessionStr: string): Record<string, any> => {
    const bytes = CryptoJS.AES.decrypt(sessionStr, AESKEY);
    const session = bytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(session);
};
