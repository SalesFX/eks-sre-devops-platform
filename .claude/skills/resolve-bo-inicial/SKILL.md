---
name: resolve-bo-inicial
description: |
  Runbook completo de rebuild da plataforma devops-ia do zero: limpar infra, subir Terraform,
  configurar banco, criar secrets, build/push de imagens, deploy Kubernetes, ArgoCD e monitoring.
  Use esta skill IMEDIATAMENTE sempre que o usuário pedir para subir tudo do zero, recriar a
  infraestrutura, fazer um fresh deploy, rebuild completo, ou quando relatar problemas como:
  banco sem usuario, secret nao encontrado, migration falhando, ImagePullBackOff apos rebuild,
  ArgoCD nao sincronizando, pods com ErrImagePull, backend-secrets not found, app_user nao existe,
  Authentication failed against database, terraform state vazio apos destroy, lock no S3,
  ArgoCD immutable selector error, grafana-admin-secret missing, kustomize commonLabels conflict.
  Palavras-chave: subir tudo, rebuild, do zero, fresh deploy, destruir e recriar, limpar tudo,
  banco nao conecta, secret nao existe, migration falhou, imagem nao puxa, ArgoCD fora de sync.
---

# resolve-bo-inicial — Runbook de Rebuild Completo

Guia completo para recriar toda a plataforma devops-ia do zero, com todos os passos que
precisam ser feitos manualmente apos o Terraform terminar.

## Contexto

| Item | Valor |
|---|---|
| Cluster EKS | `devops-ia-production` |
| Regiao | `us-east-1` |
| Conta AWS | `074994084847` |
| S3 State Bucket | `devops-ia-production-terraform-state-074994084847` |
| RDS Host | `devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com` |
| DB Name | `devops_ia` |
| DB Master User | `dbadmin` (senha no Secrets Manager) |
| DB App User | `app_user` (IAM auth, sem senha estatica) |
| Raiz das stacks | `devops-ia-terraform/` |
| Raiz da app | `devops-ia-apps/` |
| Manifests K8s | `devops-ia-kubernetes/` |

---

## FASE 0 — Limpeza (se houver infra parcial)

### 0.1 Verificar o que existe na AWS

```bash
# EKS
aws eks describe-cluster --name devops-ia-production --query 'cluster.status' --output text

# VPCs
aws ec2 describe-vpcs --filters "Name=isDefault,Values=false" \
  --query 'Vpcs[*].[VpcId,Tags[?Key==`Name`].Value|[0]]' --output table

# RDS
aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus]' --output table

# ECR
aws ecr describe-repositories --query 'repositories[*].repositoryName' --output table

# IAM Roles do projeto
aws iam list-roles --query 'Roles[?starts_with(RoleName,`devops-ia`)].RoleName' --output table
```

### 0.2 Liberar locks do Terraform no S3

```bash
BUCKET="devops-ia-production-terraform-state-074994084847"
aws s3 ls s3://$BUCKET --recursive

# Deletar lock files (*.tflock)
for prefix in networking eks ci-cd addons database; do
  aws s3 rm s3://$BUCKET/$prefix/terraform.tfstate.tflock 2>/dev/null && echo "$prefix lock removido"
done
```

### 0.3 Limpar S3 completamente (state + historico + versoes)

```bash
BUCKET="devops-ia-production-terraform-state-074994084847"

aws s3api list-object-versions --bucket $BUCKET --output json | \
python3 -c "
import sys, json, subprocess
data = json.load(sys.stdin)
objects = []
for v in (data.get('Versions') or []):
    objects.append({'Key': v['Key'], 'VersionId': v['VersionId']})
for dm in (data.get('DeleteMarkers') or []):
    objects.append({'Key': dm['Key'], 'VersionId': dm['VersionId']})
print(f'Total a deletar: {len(objects)}')
if objects:
    payload = json.dumps({'Objects': objects, 'Quiet': True})
    result = subprocess.run(
        ['aws', 's3api', 'delete-objects', '--bucket', '$BUCKET', '--delete', payload],
        capture_output=True, text=True
    )
    print('OK' if result.returncode == 0 else result.stderr)
"
```

### 0.4 Limpar diretorios .terraform locais

```bash
BASE="devops-ia-terraform"
for stack in 01-networking-stack-ai 02-eks-stack-ai 03-ci-cd-stack-ai 04-addons-stack-ai 05-database-stack-ai; do
  rm -rf "$BASE/$stack/.terraform"
  rm -f "$BASE/$stack/terraform.tfstate" "$BASE/$stack/terraform.tfstate.backup"
  echo "$stack limpo"
done
```

---

## FASE 1 — Terraform (stacks 01 a 05)

Usar a skill `terraform-deploy` ou rodar manualmente em ordem:

```bash
# Para cada stack em ordem:
cd devops-ia-terraform/01-networking-stack-ai
terraform init
terraform fmt
terraform validate
terraform plan -var-file="envs/production.tfvars"
terraform apply -auto-approve -var-file="envs/production.tfvars"
```

**Ordem obrigatoria:** 01 -> 02 -> 03 -> 04 -> 05

**Timeouts esperados:**
- Stack 02 (EKS): 15-20 min
- Stack 04 (Addons): 5-10 min
- Stack 05 (RDS): 10-15 min

---

## FASE 2 — Configurar kubectl

Apos o EKS estar ACTIVE:

```bash
aws eks update-kubeconfig --name devops-ia-production --region us-east-1
kubectl get nodes  # confirmar 4 nodes Ready
```

---

## FASE 3 — Setup inicial do banco RDS (OBRIGATORIO no primeiro deploy)

O RDS cria o banco `devops_ia` e o usuario master `dbadmin`, mas o `app_user` nao existe.
Precisa ser criado manualmente via pod temporario no cluster (dentro da VPC).

### 3.1 Obter a senha master do Secrets Manager

```bash
cd devops-ia-terraform/05-database-stack-ai
MASTER_SECRET_ARN=$(terraform output -raw db_master_user_secret_arn)
aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" \
  --query 'SecretString' --output text
# Resultado: {"username":"dbadmin","password":"<SENHA>"}
```

### 3.2 Criar o app_user e dar permissoes

```bash
DB_HOST="devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com"
MASTER_PASS="<senha do passo 3.1>"

# Criar usuario
kubectl run pg-createuser --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=$MASTER_PASS" \
  -- psql -h $DB_HOST -U dbadmin -d postgres -c "CREATE USER app_user;" 2>&1

sleep 10
kubectl logs pg-createuser -n app
kubectl delete pod pg-createuser -n app --force

# Dar grants de IAM + permissoes no banco
kubectl run pg-grants --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=$MASTER_PASS" \
  -- psql -h $DB_HOST -U dbadmin -d devops_ia \
  -c "GRANT rds_iam TO app_user; GRANT ALL PRIVILEGES ON DATABASE devops_ia TO app_user; GRANT ALL ON SCHEMA public TO app_user; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;" 2>&1

sleep 10
kubectl logs pg-grants -n app
kubectl delete pod pg-grants -n app --force
```

---

## FASE 4 — Build e Push de imagens para ECR

Sempre usar `--platform=linux/amd64`. Taggear com `sha-<git-sha>` E `latest`.

```bash
SHA="sha-$(git rev-parse --short HEAD)"
ACCOUNT="074994084847"
REGION="us-east-1"

# Login ECR
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# Backend
cd devops-ia-apps/backend
docker build --platform=linux/amd64 \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:$SHA \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:latest \
  .
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:$SHA
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:latest

# Frontend
cd ../frontend/devops-ia-platform
docker build --platform=linux/amd64 \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:$SHA \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:latest \
  .
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:$SHA
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:latest
```

### 4.1 Atualizar tag no kustomization.yaml

```bash
# Editar devops-ia-kubernetes/kustomization.yaml
# Trocar o newTag em ambas as imagens para o SHA atual
# Depois commitar e pushar para o branch clean-main (ArgoCD le desse branch)
git add devops-ia-kubernetes/kustomization.yaml
git commit -m "chore: update image tag to $SHA"
git push origin clean-main
```

---

## FASE 5 — Criar Secrets e Namespace no Kubernetes

### 5.1 Namespace app

```bash
kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
```

### 5.2 backend-secrets (IAM token + JWT)

O token IAM dura 15 minutos. Gerar imediatamente antes de criar o secret.

```bash
DB_HOST="devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com"

# Gerar token e salvar em arquivo temporario (evitar problemas de expansao no shell)
aws rds generate-db-auth-token \
  --hostname $DB_HOST --port 5432 --region us-east-1 --username app_user \
  > /tmp/iam_token.txt

# Construir DATABASE_URL com encoding correto de todos os caracteres especiais
DATABASE_URL=$(python3 - <<'EOF'
import urllib.parse
with open('/tmp/iam_token.txt') as f:
    token = f.read().strip()
encoded = urllib.parse.quote(token, safe='')
print(f"postgresql://app_user:{encoded}@devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com:5432/devops_ia?sslmode=require")
EOF
)
rm -f /tmp/iam_token.txt

# Gerar JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Criar o secret
kubectl create secret generic backend-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=jwt-secret="$JWT_SECRET" \
  -n app \
  --dry-run=client -o yaml | kubectl apply -f -

echo "JWT_SECRET gerado: $JWT_SECRET"
# SALVE este valor no STATUS.md
```

**ATENCAO:** O token IAM expira em 15 minutos. O migration job precisa rodar dentro desse prazo.
Se o job falhar com "Authentication failed", gere um token novo e recrie o secret.

---

## FASE 6 — Deploy da aplicacao via Kustomize

**SEMPRE usar `kubectl apply -k` e nao `kubectl apply -f` individual.**
O kustomize adiciona o namespace `app` e a tag de imagem correta automaticamente.

```bash
# Aplicar tudo de uma vez (namespace, configmap, serviceaccount, deployments, services, ingress)
kubectl apply -k devops-ia-kubernetes/

# Aguardar migration completar
kubectl wait --for=condition=complete job/backend-migration -n app --timeout=120s

# Verificar pods
kubectl get pods -n app
```

Se o migration job falhar com "Authentication failed":
1. Regenerar o token IAM (Fase 5.2)
2. `kubectl delete job backend-migration -n app`
3. `kubectl apply -k devops-ia-kubernetes/`

---

## FASE 7 — Instalar ArgoCD

```bash
# Criar namespace
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -

# Instalar com server-side apply (CRDs sao grandes demais para client-side)
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml \
  --server-side --force-conflicts

# Aguardar todos os pods ficarem prontos
kubectl wait --for=condition=available deployment/argocd-server -n argocd --timeout=180s

# Pegar senha admin
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d
```

---

## FASE 8 — Instalar Monitoring (VictoriaMetrics + Grafana)

### 8.1 Criar namespace e secret do Grafana ANTES de aplicar a ArgoCD Application

```bash
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -

GRAFANA_PASS=$(openssl rand -base64 16)
kubectl create secret generic grafana-admin-secret \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$GRAFANA_PASS" \
  -n monitoring \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Grafana password: $GRAFANA_PASS"
# SALVE este valor no STATUS.md
```

### 8.2 Aplicar as ArgoCD Applications

```bash
kubectl apply -f devops-ia-kubernetes/argocd-application.yaml
kubectl apply -f devops-ia-kubernetes/monitoring-application.yaml
```

### 8.3 Verificar sync

```bash
kubectl get applications -n argocd
# devops-ia:  deve ficar Synced + Healthy
# monitoring: pode aparecer OutOfSync para kube-controller-manager (normal no EKS, ignorar)
```

---

## FASE 9 — Verificacao final

```bash
echo "=== Nodes ==="
kubectl get nodes

echo "=== App namespace ==="
kubectl get pods -n app

echo "=== Monitoring namespace ==="
kubectl get pods -n monitoring

echo "=== ArgoCD Applications ==="
kubectl get applications -n argocd

echo "=== Ingress (ALB endpoint) ==="
kubectl get ingress -n app

echo "=== RDS ==="
aws rds describe-db-instances \
  --db-instance-identifier devops-ia-production \
  --query 'DBInstances[0].DBInstanceStatus' --output text
```

---

## FASE 10 — Seed do usuario demo

O banco e recriado vazio. O usuario demo nao existe. Criar via API apos a app estar no ar:

```bash
ALB="<endpoint do kubectl get ingress -n app>"

curl -s -X POST "http://$ALB/backend/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"notsamuelsales@gmail.com","password":"DevOps@2026","name":"Demo User"}'
```

Confirmar que o login funciona:

```bash
curl -s -X POST "http://$ALB/backend/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"notsamuelsales@gmail.com","password":"DevOps@2026"}'
# Deve retornar {"token":"...","user":{...}}
```

---

## Problemas conhecidos e solucoes

### "spec.selector: Invalid value ... field is immutable"

Causa: `commonLabels` no `kustomization.yaml` tenta modificar o selector dos Deployments.
Solucao: o `kustomization.yaml` nao deve ter `commonLabels`. As labels ja estao em cada manifesto.

### "secret backend-secrets not found"

Causa: secret nao foi criado antes do deploy.
Solucao: executar Fase 5.2 completa antes de `kubectl apply -k`.

### "Authentication failed against database"

Causa: token IAM expirou (validade 15 min) ou app_user nao existe no banco.
Solucao 1 (token expirado): regenerar token e recriar `backend-secrets`.
Solucao 2 (user nao existe): executar Fase 3.2.

### "ErrImagePull" ou "ImagePullBackOff"

Causa: imagem com tag especifica nao existe no ECR (ex: `latest` nao foi pushado).
Solucao: pushar ambas as tags (`sha-XXXXXXX` e `latest`) e verificar com:
```bash
aws ecr describe-images --repository-name devops-ia/production/backend \
  --query 'imageDetails[*].imageTags' --output table
```

### "another operation is already in progress" no ArgoCD

Causa: sync anterior ainda em execucao.
Solucao: aguardar o timeout ou cancelar via UI/CLI do ArgoCD. O auto-sync vai sincronizar automaticamente.

### ArgoCD monitoring falha com "must be no more than 63 characters"

Causa: `releaseName: victoria-metrics` gera nomes como `victoria-metrics-victoria-metrics-k8s-stack-kube-controller-manager` (66+ chars).
Solucao: usar `releaseName: vm` no `monitoring-application.yaml`. Nomes gerados ficam em ~53 chars.

### ArgoCD monitoring OutOfSync para kube-controller-manager

Causa: EKS nao expoe o kube-controller-manager como Service (gerenciado pela AWS).
Solucao: ignorar. O monitoring esta funcionando normalmente. Nao e um erro real.

### Terraform lock no S3 sem processo rodando

Causa: apply foi interrompido e o lock nao foi liberado.
Solucao: deletar o arquivo `*.tflock` no S3 (ver Fase 0.2).

### State Terraform vazio mas recurso existe na AWS (state drift)

Causa: apply criou o recurso mas falhou antes de salvar o state.
Solucao: deletar o recurso na AWS e rodar o apply novamente (mais seguro do que importar).

---

## Acesso rapido apos subir tudo

```bash
# ArgoCD UI
kubectl port-forward svc/argocd-server -n argocd 8080:443
# https://localhost:8080  |  admin / <senha do argocd-initial-admin-secret>

# Grafana UI
kubectl port-forward svc/victoria-metrics-grafana -n monitoring 3000:80
# http://localhost:3000  |  admin / <grafana-admin-secret>

# Nodes
kubectl get nodes

# Pods de todas as namespaces
kubectl get pods -A
```
