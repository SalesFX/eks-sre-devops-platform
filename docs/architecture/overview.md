# Arquitetura Detalhada

## Stacks Terraform

Cada stack e um diretorio independente com state remoto proprio no S3. Nenhuma usa modulos comunitarios, apenas recursos nativos do provider `hashicorp/aws`.

| Stack | O que cria |
|---|---|
| `00-remote-backend-stack-ai` | S3 bucket para state + DynamoDB para lock |
| `01-networking-stack-ai` | VPC multi-AZ, subnets publicas/privadas (3 AZs), NAT Gateway, Flow Logs |
| `02-eks-stack-ai` | Cluster EKS 1.31, Node Group 4x t3.small AL2023, ECR repos, OIDC Provider |
| `03-ci-cd-stack-ai` | GitHub OIDC Provider + IAM Role `devops-ia-production-github-actions` |
| `04-addons-stack-ai` | metrics-server, AWS Load Balancer Controller, EBS CSI Driver, StorageClass gp3 |
| `05-database-stack-ai` | RDS PostgreSQL 16, IRSA para backend, SG, CloudWatch alarms, SNS |

## Autenticacao IAM no banco (IRSA)

O backend nao usa senha de banco. O fluxo completo:

1. Pod tem ServiceAccount `backend` anotado com o ARN da IRSA role
2. EKS injeta token OIDC no pod via `automountServiceAccountToken: true`
3. `src/lib/prisma.ts` usa `@aws-sdk/rds-signer` para gerar token IAM (SigV4, valido 15 min)
4. Prisma conecta com `postgresql://app_user:<token>@<host>:5432/devops_ia?sslmode=require`
5. Timer faz refresh proativo a cada 13 minutos (2 min antes do vencimento)

O `app_user` precisa ter `GRANT rds_iam` no PostgreSQL. Sem esse grant, o token IAM e rejeitado mesmo sendo valido no nivel AWS (dupla autorizacao: IAM + PostgreSQL).

## Pipeline CI/CD

Trigger: push em `clean-main` com mudancas em `devops-ia-apps/**`

| Job | O que faz |
|---|---|
| `detect-changes` | Detecta quais apps mudaram via `dorny/paths-filter` |
| `build-backend` | Autentica via OIDC, docker build, push para ECR com tag `sha-<7 chars>` |
| `build-frontend` | Mesma sequencia para o Next.js 14 |
| `update-kustomization` | Atualiza tags no `kustomization.yaml`, commita com `[skip ci]` |

O ArgoCD detecta o novo commit e sincroniza o cluster automaticamente. O Migration Job (PreSync hook) roda `prisma migrate deploy` antes de qualquer deploy. Se a migration falhar, o sync e abortado.

## Pipeline de Seguranca

Trigger: push em `clean-main` e PRs. Varredura diaria as 06:00 UTC.

| Job | Ferramenta | Criterio de bloqueio |
|---|---|---|
| `secret-scan` | Gitleaks | Qualquer achado bloqueia |
| `iac-tf-scan` | Checkov | CRITICAL bloqueia |
| `iac-k8s-scan` | Checkov | CRITICAL bloqueia |
| `sast-frontend` | Semgrep | Findings viram anotacoes no PR |
| `sast-backend` | Semgrep | Findings viram anotacoes no PR |
| `sca-frontend` | npm audit + Trivy fs | CRITICAL bloqueia, HIGH: SLA 7 dias |
| `sca-backend` | npm audit + Trivy fs | CRITICAL bloqueia, HIGH: SLA 7 dias |
| `container-frontend` | Trivy image | CRITICAL bloqueia |
| `container-backend` | Trivy image | CRITICAL bloqueia |

## Kubernetes e GitOps

O ArgoCD monitora `clean-main`, path `devops-ia-kubernetes/`, com `automated: {prune: true, selfHeal: true}`. Qualquer commit vira realidade no cluster em ate 3 minutos.

Requisitos por Deployment:
- 2 replicas minimo
- `RollingUpdate` com `maxUnavailable: 0` (zero downtime)
- `readinessProbe` + `livenessProbe`
- `requests` + `limits` de CPU e memoria
- `podAntiAffinity` preferencial por hostname
- `revisionHistoryLimit: 3`
- `runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`

## Observabilidade

Stack VictoriaMetrics k8s stack (Helm, `releaseName: vm`), namespace `monitoring`, gerenciada pelo ArgoCD.

| Componente | Funcao |
|---|---|
| `vmsingle` | Armazena metricas (PVC gp3 5 Gi, encrypted, retencao 7d) |
| `vmagent` | Scraping de metricas de pods, nodes e objetos Kubernetes |
| `vmalert` | Avaliacao de regras de alerta (VMRules) |
| `grafana` | Dashboards, datasource Prometheus apontando para vmsingle |
| `kube-state-metrics` | Metricas de estado dos objetos Kubernetes |
| `node-exporter` | DaemonSet: metricas de hardware e SO dos nodes |

CloudWatch alarms para RDS: `DatabaseConnections > 80`, `FreeStorageSpace < 5 GB`, `FreeableMemory < 64 MB`. Todos com notificacao via SNS para email.

## Seguranca

| Componente | Metodo |
|---|---|
| Backend -> RDS | IAM Database Auth via IRSA (token SigV4 15 min, sem senha estatica) |
| GitHub Actions -> AWS | OIDC federation (sem credenciais estaticas no repositorio) |
| EBS CSI Driver -> AWS | IRSA dedicada |
| Pods | `runAsNonRoot`, `readOnlyRootFilesystem`, drop ALL capabilities |
| Volumes EBS | gp3 encrypted |
| TLS no banco | `rds.force_ssl = 1` + `sslmode=require` na connection string |
| Secrets fora do Git | `backend-secrets`, `grafana-admin-secret`, criados manualmente e nunca commitados |

## ADRs

| ADR | Titulo | Status |
|---|---|---|
| ADR-0001 | VPC multi-AZ com subnets publicas e privadas | Accepted |
| ADR-0002 | Backend remoto S3 para o state do Terraform | Accepted |
| ADR-0003 | Cluster EKS e configuracao do node group | Accepted |
| ADR-0004 | OIDC Provider e IAM Role para GitHub Actions | Accepted |
| ADR-0005 | Pipeline CI/CD com GitHub Actions | Accepted |
| ADR-0006 | ArgoCD e padrao GitOps | Accepted |
| ADR-0007 | Observabilidade com VictoriaMetrics (free-tier) | Accepted |
| ADR-0009 | Seguranca no pipeline com scans automatizados | Accepted |
| ADR-0010 | Estrategia de rollback e recovery | Accepted |
| ADR-0013 | RDS PostgreSQL free-tier | Accepted |
| ADR-0014 | Conectividade EKS-RDS via IRSA (IAM Database Auth) | Accepted |
| ADR-0015 | Autenticacao JWT | Accepted |
| ADR-0016 | Database migrations com Prisma migrate deploy | Accepted |
| ADR-0017 | Observabilidade de app e RDS (CloudWatch alarms) | Accepted |
