import { DB_FILE_PATH, DOWNLOAD_DIR } from '../constant';
import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';
const CryptoJS = require("crypto-js");
import fs from 'fs';

export const initDB = async () => {
    const db = await getDB();
    await db.exec(`CREATE TABLE IF NOT EXISTS session (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region CHAR(20),
            session  VARCHAR(800)
        )`);
};
export const getDB = async () => {
    return await open({
        filename: DB_FILE_PATH,
        driver: sqlite3.Database,
    });
};

export const saveSessionToDB = async (type: 'CN' | 'GLOBAL', session: string) => {
    const db = await getDB();
    await db.run(`
      INSERT INTO session (region,session) VALUES (${type},${session}),
    `);
};

export const isDBReady = () => {

};
