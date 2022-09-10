import httpx

from sqlite_db import SqliteDB
TIME_OUT = httpx.Timeout(1000.0, connect=1000.0)

class RQConnect:
    def __init__(self, email, password, rqdbpath) :
        self.headers = {
            "Host" : "www.runningquotient.cn",
            "Content-Type": "application/x-www-form-urlencoded",
            "authorization" : "PtCNFNv2FrKVmWuKzALA",
            "accept-encoding" : "br;q=1.0, gzip;q=0.9, deflate;q=0.8",
            "user-agent" : "RQ Run/2.9.4 (cn.runningquotient.RQ-Run; build:12; iOS 14.6.0) Alamofire/2.9.4",
            "accept-language" : "zh-Hans-HK;q=1.0, en-HK;q=0.9, en-GB;q=0.8, yue-Hant-HK;q=0.7",
        }
        self.req = httpx.AsyncClient(timeout=TIME_OUT)
        self.email = email
        self.password = password
        self.rqdbpath = rqdbpath
    
    async def login(self, aesChiper):
        data = {
            "email": self.email,
            "password": self.password,
        }
        response = await self.req.post(
            "https://www.runningquotient.cn/v1/auth/token",
            headers=self.headers,
            data=data
        )
        result = response.json()

        ## 判断登录是否成功
        if result['syscode'] == 200:
            '''
                登录成功逻辑
            '''
            with SqliteDB(self.rqdbpath) as db:
                ## 根据登录帐号查询数据库信息
                query_set = db.execute('select * from user_info where email=?', (self.email, )).fetchall()
                ## 查询条数
                query_size = len(query_set)
                ## 加密access_token
                encrypt_access_token = aesChiper.encrypt(result['data']['access_token'])
                ## 加密user_id
                encrypt_user_id = aesChiper.encrypt(str(result['data']['user_id']))
                ## 如果为0说明是第一次执行脚步，则插入数据
                if query_size == 0:
                    db.execute('insert into user_info (email,user_id,access_token) values (?, ?, ?)', (self.email, encrypt_user_id, encrypt_access_token))
                else:
                    if query_size == 1:
                        '''
                            如果为1说明是已经执行过脚步出现了Token过期情况，则需更新用户信息
                        '''
                        id = query_set[0][0]
                        update_sql = f"UPDATE user_info set user_id = '{encrypt_user_id}' , access_token='{encrypt_access_token}' where id = {id}"
                        db.execute(update_sql)
                    
                    elif query_size > 1:
                        '''
                            如果大于1删除所有已存在的信息，然后重新插入数据保持用户唯一
                        '''
                        for row in query_set:
                            db.execute('delete from user_info where id = ? ', (row[0],))
                        db.execute('insert into user_info (email,user_id,access_token) values (?, ?, ?)', (self.email, encrypt_user_id, encrypt_access_token))
            return True
        else:
            return False

    ## 判断Token是否过期
    async def isExpiredToken(self, aesChiper, encrypt_user_id, encrypt_access_token):
        
        getUserInfoHeader = {
            "Host" : "www.runningquotient.cn",
            "authorization" : "PtCNFNv2FrKVmWuKzALA",
            "accept-encoding" : "br;q=1.0, gzip;q=0.9, deflate;q=0.8",
            "user-agent" : "RQ Run/2.9.4 (cn.runningquotient.RQ-Run; build:12; iOS 14.6.0) Alamofire/2.9.4",
            "accept-language" : "zh-Hans-HK;q=1.0, en-HK;q=0.9, en-GB;q=0.8, yue-Hant-HK;q=0.7",
        }

        getUserInfoHeader['x-user-token'] = aesChiper.decrypt(encrypt_access_token)
        decrypt_user_id = aesChiper.decrypt(encrypt_user_id)
        getUserInfoUrl = f"https://www.runningquotient.cn/v1/user?userId={decrypt_user_id}"


        response = await self.req.get(
            getUserInfoUrl,
            headers=getUserInfoHeader
        )
        result = response.json()
        if result['syscode'] == 200:
            return False
        else:
            return True
