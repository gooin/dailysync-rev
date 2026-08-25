import fs from 'fs';

const LOG_DIR = './log';
// name -> 本次运行的 stamp，保证失败明细与主日志落到同一时间戳文件
const activeRuns: Record<string, string> = {};

export const MIGRATE_CN2GLOBAL_LOG_NAME = 'migrate_cn_to_global';
export const MIGRATE_GLOBAL2CN_LOG_NAME = 'migrate_global_to_cn';

const runStamp = (): string => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

/**
 * 把 stdout 按完整行镜像到 log/<name>_<时间戳>.log
 * 进度条的 \r 原地刷新不带换行，不会写进文件，避免文件里全是进度条残片
 */
export const attachLogFile = (name: string): string => {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const stamp = runStamp();
    activeRuns[name] = stamp;
    const filePath = `${LOG_DIR}/${name}_${stamp}.log`;
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    const originalWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        // 只落完整行（带 \n），进度条 \r 残片忽略
        if (text.includes('\n')) {
            stream.write(text.replace(/\r/g, ''));
        }
        return originalWrite(chunk, ...rest);
    };
    stream.write(`[${new Date().toISOString()}] [启动] ${name}\n`);
    console.log(`迁移日志文件: ${filePath}`);
    return filePath;
};

/**
 * 记录一条失败明细到 log/<name>_<时间戳>_failed.log（与主日志同一时间戳）
 */
export const logMigrationFailure = (name: string, msg: string): void => {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    if (!activeRuns[name]) {
        activeRuns[name] = runStamp();
    }
    fs.appendFileSync(`${LOG_DIR}/${name}_${activeRuns[name]}_failed.log`, `[${new Date().toISOString()}] ${msg}\n`);
};
