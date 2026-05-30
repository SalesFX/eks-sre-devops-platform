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
| 04 addons | Aplicada | metrics-server, AWS LBC, EBS CSI Driver (IRSA `devops-ia-production-ebs-csi`) |
| 05 database | Aplicada | RDS PostgreSQL 16, db.t3.micro, IRSA `devops-ia-production-backend-irsa` |

### EKS Addons

| Addon | Versão | Status |
|---|---|---|
| vpc-cni | gerenciado | Active |
| coredns | gerenciado | Active |
| kube-proxy | gerenciado | Active |
| aws-ebs-csi-driver | v1.60.1-eksbuild.1 | Active |

### StorageClasses

| Nome | Provisioner | Tipo | Default |
|---|---|---|---|
| gp2 | kubernetes.io/aws-ebs | gp2 | Não |
| gp3 | ebs.csi.aws.com | gp3, encrypted | Sim |

### Cluster EKS (namespace `app`)

| Componente | Status | Observação |
|---|---|---|
| 4 nodes t3.small | Ready | Nodes em us-east-1a/b/c |
| AWS Load Balancer Controller | Running | namespace kube-system |
| metrics-server | Running | namespace kube-system |
| EBS CSI Controller | Running | 2 replicas, namespace kube-system |
| EBS CSI Node | Running | DaemonSet em todos os 4 nodes |
| ArgoCD | Running | namespace argocd, rastreando clean-main |
| backend (2 pods) | Running | Imagem `sha-364357f`, porta 3001, IRSA auth |
| frontend (2 pods) | Running | Imagem `sha-a15a281`, porta 3000 |
| migration job | PreSync hook | `prisma migrate deploy`, roda antes de cada sync |

### Monitoring (namespace `monitoring`)

| Componente | Status |
|---|---|
| Grafana | 3/3 Running |
| Victoria Metrics (vmsingle) | 1/1 Running, PVC 5Gi |
| vmagent | 2/2 Running |
| vmalert | 2/2 Running (blackhole notifier) |
| kube-state-metrics | 1/1 Running |
| node-exporter | 1/1 em cada node (4 total) |

Acesso ao Grafana:
```bash
kubectl port-forward -n monitoring svc/victoria-metrics-grafana 3000:80
```
Credenciais no Secret `grafana-admin-secret` (namespace monitoring).

### ALB (Ingress — namespace `app`)

- **Endereço:** `k8s-app-devopsia-a05a05588d-34662498.us-east-1.elb.amazonaws.com`
- Roteamento: `/backend/*` → backend:3001 | `/` → frontend:3000
- `target-type: ip` (ALB roteia direto para IPs dos pods)
- Testado: health, login, criar incidente, dashboard — todos OK

### RDS PostgreSQL

- Instância: `devops-ia-production`, db.t3.micro, single-AZ
- Banco: `devops_ia`
- Autenticação: **IAM Database Auth via IRSA** (sem senha estática)
- `app_user` criado com `GRANT rds_iam` — backend autentica via token efêmero 15 min
- Migrations: `prisma migrate deploy` com baseline `0_init` registrada
- Master secret ARN: `arn:aws:secretsmanager:us-east-1:074994084847:secret:rds!db-c6c7efc5-b3fd-43a1-b262-dc67af83715b-beQ3Ld`

### GitOps e CI/CD

- ArgoCD Application `devops-ia`: `Synced + Healthy`, auto-sync ligado, namespace destino `app`
- ArgoCD Application `monitoring`: instalada, `Healthy`
- Pipeline CI/CD (`ci-cd.yml`): ativo em `clean-main`, builds backend/frontend e atualiza kustomization.yaml automaticamente
- Security scans (`security-scans.yml`): Gitleaks, Checkov, Semgrep, npm audit, Trivy em cada push

### K8s Secrets criados manualmente (fora do Git)

| Secret | Namespace | Chaves |
|---|---|---|
| `backend-secrets` | app | `jwt-secret` (database-url removido — IRSA substituiu) |
| `grafana-admin-secret` | monitoring | `admin-user`, `admin-password` |

---

## Arquitetura de segurança

| Componente | Método |
|---|---|
| Backend → RDS | IAM Database Auth via IRSA (token 15 min, sem senha estática) |
| GitHub Actions → AWS | OIDC federation (sem credenciais estáticas) |
| EBS CSI Driver → AWS | IRSA (`devops-ia-production-ebs-csi`) |
| Pods | runAsNonRoot, readOnlyRootFilesystem, drop ALL caps |
| Volumes EBS | gp3 encrypted |

---

## O que falta (prioridade baixa — polish de portfólio)

| Item | ADR | Observação |
|---|---|---|
| CloudWatch alarms para RDS | ADR-0017 | DatabaseConnections, FreeStorageSpace, FreeableMemory |
| README atualizado | — | Refletir stack atual (Node.js, Incident Tracker, IRSA, monitoring) |
| Apagar branch `clean-main` do repo antigo | — | `git push git@github-salesfx:SalesFX/eks-gitops-platform-AI.git --delete clean-main` |
| vmsingle migrar PVC de gp2 para gp3 | — | PVC atual bound em gp2 (provisionado antes do EBS CSI); recriar para usar gp3 |
| Usuário demo seed | — | Script para criar usuário de demo pré-cadastrado |

---

## Problemas resolvidos nesta sessão (não regredir)

- IRSA trust policy estava scopada a `default:backend` — corrigida para `app:backend`
- `ingress.yaml` tinha `namespace: default` hardcoded impedindo migração — removido
- `migration-job.yaml` usava `prisma db push --accept-data-loss` — trocado para `migrate deploy`
- `prisma/migrations/` não existia — baseline `0_init` criada e registrada no RDS
- `@aws-sdk/rds-signer` adicionado e `prisma.ts` reescrito com token IAM + refresh proativo
- Cast TypeScript inválido em `prisma.ts` (`as Record`) — corrigido via `as unknown as`
- Workflows CI/CD apontavam para `main` — corrigidos para `clean-main`
- EBS CSI Driver ausente impedia PVCs — instalado como addon gerenciado com IRSA
- StorageClass `gp3` criada como default do cluster
- VPC ID do AWS LBC estava desatualizado no state Terraform — corrigido
- Namespace `default` para `app` — toda stack de app migrada

---

## Dados importantes

| Item | Valor |
|---|---|
| Conta AWS | `074994084847` |
| Região | `us-east-1` |
| Cluster EKS | `devops-ia-production` |
| ALB endpoint | `k8s-app-devopsia-a05a05588d-34662498.us-east-1.elb.amazonaws.com` |
| RDS endpoint | `devops-ia-production.cqfcm424geyn.us-east-1.rds.amazonaws.com:5432` |
| RDS database | `devops_ia` |
| RDS master user | `dbadmin` |
| RDS master secret ARN | `arn:aws:secretsmanager:us-east-1:074994084847:secret:rds!db-c6c7efc5-b3fd-43a1-b262-dc67af83715b-beQ3Ld` |
| GitHub Actions role ARN | `arn:aws:iam::074994084847:role/devops-ia-production-github-actions` |
| Backend IRSA role ARN | `arn:aws:iam::074994084847:role/devops-ia-production-backend-irsa` |
| EBS CSI IRSA role ARN | `arn:aws:iam::074994084847:role/devops-ia-production-ebs-csi` |
| ECR backend | `074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/backend` |
| ECR frontend | `074994084847.dkr.ecr.us-east-1.amazonaws.com/devops-ia/production/frontend` |
| Imagem backend atual | `sha-364357f` |
| Imagem frontend atual | `sha-a15a281` |
