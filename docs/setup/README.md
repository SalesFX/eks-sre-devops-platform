# Guia de Setup Completo

Passo a passo para recriar o ambiente do zero.

## Pre-requisitos

- AWS CLI configurada com permissoes para VPC, EKS, IAM, S3, ECR, RDS
- Terraform `>= 1.10`
- kubectl instalado
- Docker instalado (para build das imagens)

## 1. Backend remoto

```bash
cd devops-ia-terraform/00-remote-backend-stack-ai
terraform init && terraform apply -var-file="envs/production.tfvars"
```

## 2. Infraestrutura (Rede, EKS, OIDC, Addons)

```bash
for stack in 01-networking-stack-ai 02-eks-stack-ai 03-ci-cd-stack-ai 04-addons-stack-ai; do
  cd devops-ia-terraform/$stack
  terraform init
  terraform apply -auto-approve -var-file="envs/production.tfvars"
  cd ../..
done

aws eks update-kubeconfig --name devops-ia-production --region us-east-1
kubectl get nodes
```

## 3. Banco de dados RDS

```bash
cd devops-ia-terraform/05-database-stack-ai
terraform init && terraform apply -var-file="envs/production.tfvars"

# Senha master do RDS (gerenciada pelo Secrets Manager)
MASTER_SECRET_ARN=$(terraform output -raw db_master_user_secret_arn)
MASTER_PASS=$(aws secretsmanager get-secret-value --secret-id "$MASTER_SECRET_ARN" \
  --query 'SecretString' --output text | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['password'])")

# Criar app_user com IAM auth (via pod temporario — banco e privado)
kubectl create namespace app
kubectl run pg-setup --image=postgres:16-alpine --restart=Never -n app \
  --env="PGPASSWORD=$MASTER_PASS" \
  -- psql -h <rds-host> -U dbadmin -d devops_ia \
  -c "CREATE USER app_user; GRANT rds_iam TO app_user; GRANT ALL ON DATABASE devops_ia TO app_user; GRANT ALL ON SCHEMA public TO app_user; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;"

sleep 10 && kubectl logs pg-setup -n app && kubectl delete pod pg-setup -n app --force
```

## 4. Build e Push das imagens

```bash
SHA="sha-$(git rev-parse --short HEAD)"
ACCOUNT="<account-id>"
REGION="us-east-1"

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# Backend
cd devops-ia-apps/backend
docker build --platform=linux/amd64 \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:$SHA \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:latest .
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:$SHA
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/backend:latest

# Frontend
cd ../frontend/devops-ia-platform
docker build --platform=linux/amd64 \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:$SHA \
  -t $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:latest .
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:$SHA
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/devops-ia/production/frontend:latest

# Atualizar kustomization.yaml e commitar
cd ../..
sed -i "s/newTag: .*/newTag: $SHA/" devops-ia-kubernetes/kustomization.yaml
git add devops-ia-kubernetes/kustomization.yaml
git commit -m "chore: update image tag to $SHA"
git push origin clean-main
```

## 5. Secrets e Deploy da aplicacao

```bash
# Gerar token IAM e criar backend-secrets (token expira em 15 min)
aws rds generate-db-auth-token \
  --hostname <rds-host> --port 5432 --region us-east-1 --username app_user \
  > /tmp/iam_token.txt

DATABASE_URL=$(python3 - <<'EOF'
import urllib.parse
with open('/tmp/iam_token.txt') as f:
    token = f.read().strip()
encoded = urllib.parse.quote(token, safe='')
print(f"postgresql://app_user:{encoded}@<rds-host>:5432/devops_ia?sslmode=require")
EOF
)
rm -f /tmp/iam_token.txt

kubectl create secret generic backend-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  -n app

# Aplicar manifestos via kustomize (nunca kubectl apply -f individual)
kubectl apply -k devops-ia-kubernetes/

# Aguardar migration job
kubectl wait --for=condition=complete job/backend-migration -n app --timeout=120s
kubectl get pods -n app
```

## 6. ArgoCD e Monitoring

```bash
# ArgoCD (server-side apply por causa do tamanho dos CRDs)
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml \
  --server-side --force-conflicts

kubectl wait --for=condition=available deployment/argocd-server -n argocd --timeout=180s

# Grafana secret (antes de aplicar a Application)
kubectl create namespace monitoring
kubectl create secret generic grafana-admin-secret \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -base64 16)" \
  -n monitoring

# ArgoCD Applications
kubectl apply -f devops-ia-kubernetes/argocd-application.yaml
kubectl apply -f devops-ia-kubernetes/monitoring-application.yaml
```

## 7. Usuario demo

```bash
ALB=$(kubectl get ingress devops-ia -n app -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

curl -X POST "http://$ALB/backend/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"Demo@2026","name":"Demo User"}'
```

## Pontos criticos

- O `kustomization.yaml` nao pode ter `commonLabels` — causa conflito de selector imutavel no ArgoCD
- Sempre usar `kubectl apply -k` e nunca `kubectl apply -f` individual — o kustomize define a tag de imagem
- O token IAM do RDS expira em 15 min — gerar imediatamente antes de criar o secret
- Monitoring `releaseName` deve ser `vm` (nao `victoria-metrics`) — nomes maiores estouram o limite de 63 chars do Kubernetes
- Para rebuild completo, use a skill `/resolve-bo-inicial`
