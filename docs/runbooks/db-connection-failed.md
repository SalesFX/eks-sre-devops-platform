# Runbook: DB Connection Failed

**Servico:** backend
**Severidade:** SEV1 (indisponibilidade total do servico — banco inacessivel)
**Tempo estimado de resolucao:** 5 a 20 minutos

---

## Sintomas

- `/backend/health` retorna `{"status":"ok","db":"error"}` ou status 503
- Logs do backend: `FATAL: PAM authentication failed for user "app_user"`
- Logs do backend: `Connection refused` ou `Connection timed out` para o endpoint RDS
- Usuarios recebem erro 500 em todas as rotas que tocam o banco

## Diagnostico

```bash
# Estado dos pods
kubectl get pods -n app -l app.kubernetes.io/name=backend

# Logs do backend
kubectl logs -n app deploy/backend --tail=50 | grep -i "error\|fatal\|connection"

# Testar conectividade direta ao banco (de dentro do cluster)
kubectl run pg-debug --rm -it --restart=Never \
  --image=postgres:16-alpine \
  --env="PGPASSWORD=<senha-do-master-via-secrets-manager>" \
  -- psql "host=<rds-endpoint> port=5432 dbname=devops_ia user=dbadmin sslmode=require" \
  -c "SELECT 1"

# Verificar security group do RDS
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=devops-ia-production-rds" \
  --region us-east-1 \
  --query 'SecurityGroups[0].IpPermissions'
```

## Causas comuns e resolucao

### Causa 1: Token IAM expirado sem renovacao

**Indicador:** log `FATAL: PAM authentication failed` logo apos 15 minutos de uptime.

**Causa raiz:** o refresh cycle do `prisma.ts` falhou silenciosamente.

**Resolucao:**
```bash
# Reiniciar o deployment forca nova geracao de token
kubectl rollout restart deployment/backend -n app
kubectl rollout status deployment/backend -n app
```

Se o problema persistir, verificar os logs do timer de refresh:
```bash
kubectl logs -n app deploy/backend | grep "\[prisma\]"
```

### Causa 2: app_user sem permissao rds_iam

**Indicador:** `FATAL: PAM authentication failed` desde o inicio.

**Resolucao:** reconectar ao banco como master e verificar:
```sql
SELECT usename, usesuper FROM pg_user WHERE usename = 'app_user';
-- Deve retornar a linha. Se nao retornar, o usuario nao existe.

-- Recriar se necessario:
CREATE USER app_user;
GRANT rds_iam TO app_user;
GRANT ALL ON SCHEMA public TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
```

### Causa 3: Security Group bloqueando a conexao

**Indicador:** `Connection timed out` (nao `Connection refused`).

**Resolucao:**
```bash
# Verificar regra de ingresso no SG do RDS
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=devops-ia-production-rds" \
  --region us-east-1 \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`5432`]'

# Verificar SG dos nodes EKS
kubectl get nodes -o jsonpath='{.items[0].spec.providerID}' | \
  xargs -I{} aws ec2 describe-instances --instance-ids {} \
  --query 'Reservations[0].Instances[0].SecurityGroups'
```

### Causa 4: RDS em manutencao ou reiniciando

**Indicador:** `Connection refused` com RDS em estado `rebooting` no console AWS.

**Resolucao:** aguardar o RDS voltar. Verificar status:
```bash
aws rds describe-db-instances \
  --db-instance-identifier devops-ia-production \
  --region us-east-1 \
  --query 'DBInstances[0].DBInstanceStatus'
```

### Causa 5: IRSA role com trust policy incorreta

**Indicador:** log `AccessDenied: Not authorized to perform sts:AssumeRoleWithWebIdentity`.

**Resolucao:** verificar anotacao do ServiceAccount e trust policy da role:
```bash
kubectl get serviceaccount backend -n app -o yaml | grep role-arn
aws iam get-role --role-name devops-ia-production-backend-irsa \
  --query 'Role.AssumeRolePolicyDocument' --region us-east-1
# Verificar se sub contem 'system:serviceaccount:app:backend' (nao default)
```

## Prevencao

- Alarme CloudWatch `rds-connections-high` (> 80) detecta acumulo de conexoes antes da falha
- Health check do backend em `/backend/health` com resposta `db: "connected"` ou `db: "error"`
- Monitorar logs do timer de refresh IRSA no Grafana (quando Loki estiver disponivel)

## Escalonamento

Se nenhuma causa acima resolver em 20 minutos: escalar para o `postgres-rds-db-senior` com os logs coletados.
