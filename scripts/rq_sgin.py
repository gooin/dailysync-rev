import argparse
import httpx
import random
import asyncio
import os

from rq_config import DB_DIR
from sqlite_db import SqliteDB
from aestools import AESCipher
from rq_connect import RQConnect

TIME_OUT = httpx.Timeout(1000.0, connect=1000.0)



class RqSgin:
    def __init__(self, userId, token) :
        self.req = httpx.AsyncClient(timeout=TIME_OUT)
        ## 签到请求头
        self.headers = {
            "Host": "rq.runningquotient.cn",
            "Origin": "https://rq.runningquotient.cn",
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
            "Referer": f"https://rq.runningquotient.cn/Minisite/SignIn/index?userId={userId}&token={token}",
        }
        ## RQ用户ID
        self.userId = userId
        ## RQ用户token
        self.token = token
    
    async def sigin(self):
        ## 随机数
        randomNum = random.uniform(0,2)
        ## 签到Url
        siginUrl = f"https://rq.runningquotient.cn/MiniApi/SignIn/sign_in/rand/{randomNum}"
        ## PHPSESSID 目前不作存储不清楚RQ原理这块是否会过期故每次请求签到都获取新的PHPSESSID，防止RQ判断用户会脚本执行签到
        PHPSESSID = await self.getSiginPHPSESSID()
        ## 设置请求头Cookie
        self.headers['Cookie'] = f"PHPSESSID={PHPSESSID}"
        try:
            ## 执行签到
            response = await self.req.post(
                siginUrl,
                headers=self.headers
            )
            result = response.json()
            ## 判断是否签到成功
            if result['status'] == 1:
                print("签到成功！！！！！")
            else:
                ## 命令行输出签到信息
                print(result)
            
            '''
                    feature:
                        未来会新增各种信息推送如 Email WebHook(企业微信、飞书等等)、Bark 等
            '''

        except Exception as err:
            raise err

    ## 调用获取请求头Referer里面的Cookie
    async def getSiginPHPSESSID(self):
        try:
            response = await self.req.get(
                self.headers.get("Referer")
            )
            return response.cookies['PHPSESSID']
        except Exception as err:
            raise err


def isKeyValid(aesChiper, text):
    try:
        aesChiper.decrypt(text)
        return True
    except Exception as e:
        return False

async def rq_sigin(email, password, AES_KEY):
    aesChiper = AESCipher(AES_KEY)
    # rq_login = RqLogin(email,password)
    rq_connect = RQConnect(email, password, rqdbpath)
    with SqliteDB(rqdbpath) as db:
        ## 查询数据库是否存在已保存的帐号信息
        query_set = db.execute('select * from user_info where email=?', (email, )).fetchall()
        ## 查询返回条数
        query_size = len(query_set)
        ## 判断是否唯一
        if query_size == 1:
            ## 加密user_id
            encrypt_user_id = query_set[0][2]
            ## 加密access_token
            encrypt_access_token = query_set[0][3]
            
            ## 判断AES KEY 能否解密当前加密数据
            isValid = isKeyValid(aesChiper, encrypt_user_id)
            
            ## 能解密则执行如下
            if isValid:
                ## 判断存储的token是否过期
                isExpired = await rq_connect.isExpiredToken(aesChiper, encrypt_user_id, encrypt_access_token)
                if not isExpired:
                    rqs = RqSgin(
                        aesChiper.decrypt(encrypt_user_id),
                        aesChiper.decrypt(encrypt_access_token)
                    )
                await rqs.sigin()
                return
            
        ## 如果数据库中存储的帐号条数大于一条默认全部删除登录后再插入一条保持数据的唯一
        elif query_size > 1:
            for row in query_set:
                db.execute('delete from user_info where id = ? ', (row[0],))
        else:
            pass
    with SqliteDB(rqdbpath) as db:
        isSuccessLogin = await rq_connect.login(aesChiper)
        
        if isSuccessLogin == True:
            query_set = db.execute('select * from user_info where email=?', (email, )).fetchall()
            ## 加密user_id
            encrypt_user_id = query_set[0][2]
            ## 加密access_token
            encrypt_access_token = query_set[0][3]
            rqs = RqSgin(
                aesChiper.decrypt(encrypt_user_id),
                aesChiper.decrypt(encrypt_access_token)
            )
            await rqs.sigin()
        else:
            print("帐号密码有误，请检查帐号密码信息！！！")

## 初始化建表
def initRQDB(rqdbpath):
    with SqliteDB(rqdbpath) as db:
        db.execute('''CREATE TABLE user_info (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            email VARCHAR(100), user_id  VARCHAR(100), access_token VARCHAR(100)
            )'''
        )


class AESKEYTooLongExceptin(Exception):
    "this is user's Exception for check the length of name "
    def __init__(self, meeasge, lens):
        self.meeasge = meeasge
        self.lens = lens
    def __str__(self):
        print(f"AES key must be either 16, 24, or 32 bytes long, current AES Key length is {str(self.lens)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", nargs="?", help="source email of garmin")
    parser.add_argument("--password", nargs="?", help="source password of garmin")
    parser.add_argument("--AESKEY", nargs="?", help="source auth domain of garmin")
    args = parser.parse_args()
    email = args.email
    password = args.password
    AES_KEY = args.AESKEY

    ## AES─KEY不能超过32位
    try:
        if(len(AES_KEY) > 32):
            raise AESKEYTooLongExceptin(f"AES KEY Too Long", len(AES_KEY))
    except AESKEYTooLongExceptin as e_result:
        print(e_result)

    ## 判断存储数据文件夹是否存在
    if not os.path.exists(DB_DIR):
        os.mkdir(DB_DIR)
    
    rqdbpath = os.path.join(DB_DIR, 'rq.db')

    ## 判断RQ数据库是否存在
    if not os.path.exists(rqdbpath):
        ## 初始化建表
        initRQDB(rqdbpath)

    loop = asyncio.get_event_loop()
    future = asyncio.ensure_future(
        rq_sigin(email, password, AES_KEY)
    )
    loop.run_until_complete(future)
    