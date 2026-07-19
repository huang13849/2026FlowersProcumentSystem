# Security Scan (密钥泄漏检测)

## 是什么
`security-scan.sh` — 检测 `.env`/硬编码密钥/DB URI 明文密码/JWT/NextAuth secret 等敏感数据被提交到 git 的自动化 test。

## 触发点
1. **pre-commit hook** — 每次本地 `git commit` 自动跑 (`.git/hooks/pre-commit`), 拒收含密钥的 commit
2. **CI 流水线** — Jenkins/Actions pre-build 阶段跑 `bash scripts/security-scan.sh head`, PR 阶段拦截
3. **定期审计** — 手动 `bash scripts/security-scan.sh audit` 扫历史 + HEAD

## 使用
```bash
bash scripts/security-scan.sh precommit  # 只看 staged 文件 (hook 自动用)
bash scripts/security-scan.sh head       # 扫 HEAD 全部文件
bash scripts/security-scan.sh audit      # 扫 HEAD + git 历史 (最严)
```

## 误报处理
1. 行级白名单: 在触发行末尾加注释 `# security-scan: ignore` 或 `// security-scan: ignore`
2. 紧急绕过 (谨慎!): `SKIP_SECURITY_SCAN=1 git commit -m "..."`

## 检测规则
- **危险文件名**: `.env`, `.env.bak`, `*.pem`, `id_rsa`, `credentials.json`, `secrets.yaml` 等
- **AWS/Stripe/GitHub/Slack** 特征字符串
- **PEM 私钥块**
- **32-64 位 hex secret** 赋值给 SECRET/KEY/TOKEN/AUTH (NextAuth/Zitadel/JWT 常见格式)
- **quoted 赋值** 到 password/secret/token/api_key/private_key/client_secret 等 (值 8+ 字符, 排除 placeholder)
- **MongoDB/Postgres/MySQL URI** 含明文密码
- **git 历史** 里出现过的敏感文件 (audit 模式)

## Placeholder 白名单
以下值视为占位符自动跳过: `your_*`, `changeme`, `example`, `xxxxx`, `<...>`, `${...}`, `{{...}}`, `placeholder`, `redacted`, `fake`, `dummy`, `sample`, `template`, `process.env`, 全同字符 (8+)

## 如果检测到真泄漏
1. **HEAD 里**: `git rm <file>` + 加 `.gitignore` + commit + push
2. **历史里**: `git filter-repo --invert-paths --path <file>` + `git push --force`
3. **值已泄漏出去**: 后台重新生成 (轮换密钥) —— 只重写历史不改密钥不安全
