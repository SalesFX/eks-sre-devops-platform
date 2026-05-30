# Status do Projeto

**Última atualização:** 2026-05-30
**Branch:** `clean-main`
**Repo:** `git@github.com:SalesFX/eks-sre-devops-platform.git`

---

## O que está no ar

### Infraestrutura AWS (Terraform)

| Stack | Status | Recursos |
|---|---|---|
| 00 remote backend | Aplicada | S3 bucket `devops-ia-production-terraform-state-074994084847` |
| 01 networking | Aplicada | VPC `vpc-06aecd0164074155b`, 3 subnets públicas + 3 privadas, NAT Gateway |
| 02 EKS | Aplicada | Cluster `devops-ia-production` (1.31), 4 nodes t3.small |
| 03 CI/CD | Aplicada | OIDC GitHub Actions, IAM role `devops-ia-production-github-actions` |
| 04 addons | Aplicada | metrics-server, AWS Load Balancer Controller (VPC corrigido) |
| 05 database | Aplicada | RDS PostgreSQL 16, db.t3.micro, endpoint `devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com` |

### Cluster EKS

| Componente | Status | Observação |
|---|---|---|
| 4 nodes t3.small | Ready | Nodes em us-east-1a/b/c |
| AWS Load Balancer Controller | Running | VPC ID corrigido via Helm upgrade direto |
| metrics-server | Running | |
| ArgoCD | Running | Namespace `argocd`, senha inicial ainda não coletada |
| backend (2 pods) | Running | Imagem `sha-a15a281-r3`, porta 3001, DB conectado |
| frontend (2 pods) | Running | Imagem `sha-a15a281`, porta 3000 |
| migration job | Completed | `prisma db push` rodou com sucesso, schema criado no RDS |

### ALB (Ingress)

- **Endereço:** `k8s-default-devopsia-14aff0ed21-1708557461.us-east-1.elb.amazonaws.com`
- `/backend/health` retorna `{"status":"ok","db":"connected"}` (testado de dentro do pod)
- Roteamento: `/backend/*` → backend:3001 | `/` → frontend:3000
- **Pendente:** testar via ALB de fora (curl ainda não retornou — ALB pode estar terminando)

### RDS PostgreSQL

- Instância: `devops-ia-production`, db.t3.micro, single-AZ
- Banco: `devops_ia`
- Autenticação: password (master via Secrets Manager) — IRSA ainda não implementado no código Node.js
- `backup_retention_period = 0` (free tier não permite > 0)
- Schema criado via `prisma db push`
- Master secret ARN: `arn:aws:secretsmanager:us-east-1:074994084847:secret:rds!db-c6c7efc5-b3fd-43a1-b262-dc67af83715b-beQ3Ld`

### K8s Secrets criados manualmente (fora do Git)

| Secret | Namespace | Chaves |
|---|---|---|
| `backend-secrets` | default | `jwt-secret`, `database-url` |
| `grafana-admin-secret` | monitoring | `admin-user`, `admin-password` |

---

## O que falta para o sistema estar 100% no ar

### Prioridade alta (sistema não funciona sem isso)

1. **ArgoCD apontando pro repo certo**
   - O `argocd-application.yaml` foi atualizado para `eks-sre-devops-platform` mas ainda não foi aplicado no cluster
   - Comando: `kubectl apply -f devops-ia-kubernetes/argocd-application.yaml`
   - Depois reabilitar auto-sync (foi desabilitado durante debug de emergência)

2. **ArgoCD com acesso ao repo**
   - O repo `eks-sre-devops-platform` é privado
   - ArgoCD precisa de uma deploy key ou token para clonar
   - Configurar via UI do ArgoCD ou via secret `argocd-repo-creds`

3. **GitHub Actions configurado no novo repo**
   - Adicionar variable `AWS_ROLE_ARN = arn:aws:iam::074994084847:role/devops-ia-production-github-actions`
   - Caminho: `eks-sre-devops-platform` → Settings → Secrets and variables → Actions → Variables

4. **Testar o sistema end-to-end**
   - Acessar o ALB pelo browser
   - Login com um usuário (criar via `POST /backend/auth/register`)
   - Ver dashboard
   - Criar incidente

### Prioridade média (melhoria de segurança e operação)

5. **IRSA para autenticação RDS** (ADR-0014)
   - Código backend ainda usa password auth (DATABASE_URL com senha do master)
   - Implementar token gerado via `@aws-sdk/rds-signer` para autenticação IAM
   - Requer: adicionar `@aws-sdk/rds-signer` ao `package.json`, lógica de refresh no `src/lib/prisma.ts`
   - Criar `app_user` no banco com `GRANT rds_iam TO app_user`

6. **Migrations Prisma formais** (ADR-0016)
   - Atualmente usando `prisma db push`, não tem histórico de migrations
   - Rodar `npx prisma migrate dev --name init` localmente para criar o diretório `prisma/migrations/`
   - Trocar o migration job para `prisma migrate deploy`

7. **Monitoramento (Grafana + Prometheus)**
   - `monitoring-application.yaml` existe mas ArgoCD ainda não aplicou (aguarda sync)
   - Senha do Grafana agora via Secret `grafana-admin-secret` (criado no cluster)

8. **CloudWatch alarms para RDS** (ADR-0017)
   - DatabaseConnections > 80
   - FreeStorageSpace < 5GB
   - FreeableMemory < 128MB

9. **Registrar `app_user` no PostgreSQL**
   ```sql
   CREATE USER app_user;
   GRANT rds_iam TO app_user;
   GRANT ALL ON SCHEMA public TO app_user;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
   ```

### Prioridade baixa (portfólio polish)

10. **Apagar branch `clean-main` do repo antigo** `eks-gitops-platform-AI`
    ```bash
    git push git@github-salesfx:SalesFX/eks-gitops-platform-AI.git --delete clean-main
    ```

11. **Anti-affinity nos deployments existentes**
    - Backend e frontend deployments ainda não têm `podAntiAffinity`
    - Adicionar conforme nova convenção em `kubernetes-manifests.md`

12. **`revisionHistoryLimit: 3`** nos deployments (acúmulo de ReplicaSets foi problema real)

13. **Criar usuário demo** via script/seed para facilitar demo do portfólio

14. **README** atualizado com a nova stack (Node.js backend, Incident Tracker, RDS)

---

## Problemas resolvidos nesta sessão (não regredir)

- VPC ID do AWS LBC estava hardcoded com valor de outra conta — corrigido via remote state
- Senha do Grafana estava hardcoded em dois arquivos — removida, Secret criado no cluster
- Account ID `074994084847` hardcoded na policy IRSA — substituído por `aws_caller_identity`
- `backup_retention_period = 7` bloqueava criação do RDS em conta free tier — reduzido para 0
- Prisma binary target para Alpine era `linux-musl` (OpenSSL 1.1) — corrigido para `linux-musl-openssl-3.0.x`
- ArgoCD revertia kubectl applies locais — motivo: GitOps sempre vence; fluxo correto é commitar no Git
- IP exhaustion com 2 nodes t3.small — resolvido com scale para 4 nodes
- AWS LBC usava VPC errado (`vpc-0ca452cff561bdf41`) — corrigido para `vpc-06aecd0164074155b`
- `DATABASE_URL` não estava chegando nos pods — campo estava faltando no deployment.yaml

---

## Dados importantes

| Item | Valor |
|---|---|
| Conta AWS | `074994084847` |
| Região | `us-east-1` |
| Cluster EKS | `devops-ia-production` |
| ALB endpoint | `k8s-default-devopsia-14aff0ed21-1708557461.us-east-1.elb.amazonaws.com` |
| RDS endpoint | `devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com:5432` |
| RDS database | `devops_ia` |
| RDS master user | `dbadmin` |
| RDS master secret ARN | `arn:aws:secretsmanager:us-east-1:074994084847:secret:rds!db-c6c7efc5-b3fd-43a1-b262-dc67af83715b-beQ3Ld` |
| GitHub Actions role ARN | `arn:aws:iam::074994084847:role/devops-ia-production-github-actions` |
| Backend IRSA role ARN | `arn:aws:iam::074994084847:role/devops-ia-production-backend-irsa` |
| ECR backend | `074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/backend` |
| ECR frontend | `074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/frontend` |
| Imagem backend atual | `sha-a15a281-r3` |
| Imagem frontend atual | `sha-a15a281` |
