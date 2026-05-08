# Mock SSO

简易单点登录服务

## 环境要求

- Python 3.8, 3.9, 3.10, 3.11, 3.12, 3.13
- 支持 macOS / Windows / Linux

## 安装

```bash
pip install -r requirements.txt
```

## 运行

```bash
python app.py
```

## 测试账号

| w3Account (域账户) | 密码 | 姓名 | userName |
|--------------------|------|------|----------|
| z12345678 | 123456 | 张三 | zhangsan |
| l87654321 | 123456 | 李四 | lisi |

**注意：登录时使用域账户（w3Account）作为用户名。**

## 接口说明

| 接口 | 方法 | 说明 |
|------|------|------|
| /login | GET | 登录页面 |
| /login | POST | 登录验证，设置Cookie |
| /account/profile | GET | 获取用户信息（需Cookie） |
| /health | GET | 健康检查 |

## 本地测试

配置 hosts 文件：
```
127.0.0.1 login.bluezone.com
```

访问：http://login.bluezone.com:5000/login