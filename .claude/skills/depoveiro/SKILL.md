---
name: depoveiro
description: |
  Diagnostica problemas de saude da APLICACAO no cluster EKS devops-ia-production.
  Cobre pods do namespace app (backend, frontend), secrets ausentes, falha de conexao com RDS,
  ArgoCD Application fora de sync, migration job falhando, ImagePullBackOff, CrashLoopBackOff,
  readinessProbe falhando e servico retornando 503 no ALB.
  Use esta skill quando o usuario perguntar se a app esta no ar, se o backend esta respondendo,
  se os pods subiram, se o login funciona, ou quando relatar erro 503, pod travado, backend-secrets
  not found, db nao conecta, migration falhou, ArgoCD mostrando Degraded ou OutOfSync na app devops-ia.
  NAO use para problemas de Terraform, node group, kubectl sem credenciais ou ArgoCD sistema
  (dex crash, CNI). Esses sao do PlantonistaOps.
  Palavras-chave: app fora do ar, 503, backend nao responde, pod travado, secret nao existe,
  migration falhou, db nao conecta, ArgoCD Degraded, devops-ia OutOfSync, health check falhando.
---

# Depoveiro - Diagnostico da Aplicacao

**Escopo:** namespace `app` + ArgoCD Application `devops-ia`

| Recurso | Valor |
|---|---|
| Cluster | `devops-ia-production` |
| Namespace app | `app` |
| ALB | `k8s-app-devopsia-a05a05588d-1756438931.us-east-1.elb.amazonaws.com` |
| RDS | `devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com:5432` |
| Repo | `/home/samuelsales/DevOps-Nuvem/aws-project-sre-devops` |

---

## Passo 1 - Estado dos pods no namespace app

```bash
kubectl get pods -n app
kubectl get deployment -n app
```

Interpretar:
- Todos `1/1 Running` com 0 restarts recentes: saudavel
- `0/1 Running` com restarts crescendo: CrashLoopBackOff (ver Padrao B)
- `ErrImagePull` / `ImagePullBackOff`: imagem invalida (ver Padrao A)
- `CreateContainerConfigError`: secret ou configmap ausente (ver Padrao C)
- `ContainerCreating` por mais de 2 min: secret ausente (ver Padrao C)

---

## Passo 2 - Estado do ArgoCD Application

```bash
kubectl get application devops-ia -n argocd
```

- `Synced + Healthy`: tudo certo
- `OutOfSync + Healthy`: diff detectado mas app esta no ar, sync pendente
- `Synced + Degraded`: pods com problema mesmo apos sync
- `OutOfSync + Degraded`: sync falhou e pods com problema

---

## Passo 3 - Health do backend via ALB

```bash
curl -s http://k8s-app-devopsia-a05a05588d-1756438931.us-east-1.elb.amazonaws.com/backend/health
# Esperado: {"status":"ok","db":"connected"}
# 503: backend nao esta pronto (readinessProbe falhando)
# {"status":"ok","db":"disconnected"}: banco inacessivel
```

---

## Padrao A - ImagePullBackOff / ErrImagePull

**Causa:** tag de imagem inexistente no ECR

**Diagnostico:**
```bash
kubectl describe pod <pod> -n app | grep -A5 "Events:"
aws ecr describe-images --repository-name devops-ia/production/backend \
  --query 'imageDetails[*].imageTags' --output table
```

**Fix:**
```bash
# GitOps (preferido)
git revert HEAD && git push origin clean-main

# Imperativo (mais rapido, requer git revert depois)
kubectl set image deployment/backend \
  backend=074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/backend:sha-da9bf41 \
  -n app
kubectl set image deployment/frontend \
  frontend=074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/frontend:sha-da9bf41 \
  -n app
```

---

## Padrao B - CrashLoopBackOff

**Causa:** erro de aplicacao (exit 1) ou memoria insuficiente (exit 137)

**Diagnostico:**
```bash
kubectl logs -l app.kubernetes.io/name=backend -n app --tail=30
kubectl describe pod <pod> -n app | grep -A3 "Last State"
# Exit code 1: erro de config/aplicacao
# Exit code 137: OOMKilled
```

**Fix para OOMKilled:**
```bash
kubectl set resources deployment backend \
  --limits=memory=512Mi --requests=memory=128Mi -n app
```

**Fix para erro de aplicacao:** ver Padrao C ou D.

---

## Padrao C - CreateContainerConfigError (secret ausente)

**Causa:** `backend-secrets` nao existe no namespace `app`

**Diagnostico:**
```bash
kubectl get secret backend-secrets -n app
# Error: not found -> confirma o problema
```

**Fix:**
```bash
aws rds generate-db-auth-token \
  --hostname devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com \
  --port 5432 --region us-east-1 --username app_user > /tmp/iam_token.txt

DATABASE_URL=$(python3 - <<'EOF'
import urllib.parse
with open('/tmp/iam_token.txt') as f:
    token = f.read().strip()
encoded = urllib.parse.quote(token, safe='')
print(f"postgresql://app_user:{encoded}@devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com:5432/devops_ia?sslmode=require")
EOF
)
rm -f /tmp/iam_token.txt

kubectl create secret generic backend-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  -n app --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/backend -n app
```

---

## Padrao D - RDS inacessivel (PAM auth failed)

**Causa:** `rds_iam` revogado do `app_user` ou token IAM expirado

**Diagnostico:**
```bash
kubectl logs -l app.kubernetes.io/name=backend -n app | grep -i "PAM\|auth\|connect\|error"
```

**Fix:**
```bash
MASTER_SECRET_ARN=$(cd /home/samuelsales/DevOps-Nuvem/aws-project-sre-devops/devops-ia-terraform/05-database-stack-ai && terraform output -raw db_master_user_secret_arn)
MASTER_PASS=$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" \
  --query 'SecretString' --output text | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['password'])")

kubectl run pg-fix --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=$MASTER_PASS" \
  -- psql -h devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com \
  -U dbadmin -d devops_ia -c "GRANT rds_iam TO app_user;"

sleep 8 && kubectl logs pg-fix -n app && kubectl delete pod pg-fix -n app --force

# Apos restaurar o grant, recriar o secret (ver Padrao C)
```

---

## Padrao E - Migration Job Falhando

**Causa:** imagem ruim, secret ausente ou schema incompativel

**Diagnostico:**
```bash
kubectl logs -l job-name=backend-migration -n app --tail=20
```

**Fix:**
```bash
kubectl delete job backend-migration -n app
kubectl apply -k /home/samuelsales/DevOps-Nuvem/aws-project-sre-devops/devops-ia-kubernetes/
```

---

## Padrao F - ArgoCD Application OutOfSync ou Degraded

**Diagnostico:**
```bash
kubectl get application devops-ia -n argocd \
  -o jsonpath='{.status.operationState.message}'
```

**Fix:**
```bash
kubectl annotate application devops-ia -n argocd \
  argocd.argoproj.io/refresh=hard --overwrite
```

---

## Output esperado ao final

```
Namespace app:
  backend-xxx   1/1 Running  ok
  frontend-xxx  1/1 Running  ok

ArgoCD devops-ia: Synced / Healthy

ALB health: {"status":"ok","db":"connected"}
```
