# Cloud Native Platform on AWS

### Terraform, EKS, GitOps, DevSecOps, RDS IAM Auth, Observabilidade e Incident Response

Plataforma cloud native de portfolio na AWS com aplicacao real em producao. Demonstra praticas de ambientes enterprise: IaC em camadas com Terraform, CI/CD via OIDC sem credenciais fixas, GitOps com ArgoCD, autenticacao IAM no banco via IRSA, observabilidade com VictoriaMetrics e Grafana, e simulacao de incidentes com ciclo SRE completo.

## Stack

| Camada | Tecnologia |
|---|---|
| Compute | EKS 1.31, 4x t3.small, AL2023 |
| Infraestrutura | Terraform (5 stacks independentes, state no S3) |
| CI/CD | GitHub Actions + OIDC (sem credenciais estaticas) |
| GitOps | ArgoCD com auto-sync e self-heal |
| Backend | Node.js 20 + Express + TypeScript + Prisma ORM |
| Frontend | Next.js 14 + Tailwind CSS |
| Banco | RDS PostgreSQL 16, IAM auth via IRSA (sem senha estatica) |
| Observabilidade | VictoriaMetrics + Grafana + CloudWatch alarms + SNS |
| Seguranca | Gitleaks, Checkov, Semgrep, Trivy (10 jobs de scan) |

## Aplicacao

**Incident Tracker** — sistema real de gerenciamento de incidentes com autenticacao JWT, dashboard e historico.

![Login](docs/architecture/screenshots/frontend-login.png)

![Dashboard](docs/architecture/screenshots/frontend-dashboard.png)

![Criar Incidente](docs/architecture/screenshots/frontend-criar-alerta.png)

## Arquitetura

```mermaid
graph TD
    DEV[Desenvolvedor<br/>push clean-main]
    GHA[GitHub Actions<br/>CI/CD + Security Scans]
    ECR[Amazon ECR<br/>backend / frontend]
    KUST[kustomization.yaml<br/>image tags sha-xxxxx]
    ARGO[ArgoCD<br/>namespace argocd]
    EKS[EKS Cluster<br/>devops-ia-production<br/>4x t3.small]

    subgraph NS_APP[namespace app]
        MIG[Migration Job<br/>PreSync hook]
        BE[Backend 2 pods]
        FE[Frontend 2 pods]
    end

    RDS[RDS PostgreSQL 16<br/>private subnet]
    ALB[Application Load Balancer]
    CW[CloudWatch Alarms]
    SNS[SNS Email]

    subgraph NS_MON[namespace monitoring]
        VM[VictoriaMetrics]
        GF[Grafana]
    end

    DEV --> GHA
    GHA -->|docker push| ECR
    GHA -->|commit tag| KUST
    KUST --> ARGO
    ARGO -->|sync| EKS
    EKS --> MIG --> RDS
    EKS --> BE -->|IAM token IRSA| RDS
    ALB --> FE & BE
    CW --> SNS
    EKS --> VM --> GF
```

## Infraestrutura

![Nodes EKS](docs/architecture/screenshots/kubectl-get-nodes.png)

![ArgoCD Sync](docs/architecture/screenshots/argocd-sync-app-and-monitoring.png)

![ArgoCD Resource Tree](docs/architecture/screenshots/argocd-arvore-app.png)

## Observabilidade

![Grafana Nodes](docs/architecture/screenshots/grafana-nodes.png)

![Grafana Pods](docs/architecture/screenshots/grafana-pods.png)

## Pipeline

![CI/CD](docs/architecture/screenshots/pipeline-cicd.png)

![Security Scans](docs/architecture/screenshots/pipeline-security.png)

## CloudWatch e Alertas

![CloudWatch e Email SNS](docs/architecture/screenshots/alerta-aws-recursos-db-rds-email.png)

## Incident Response em Producao

4 incidentes simulados em ambiente real com ciclo SRE completo: deteccao via alerta no Grafana, resolucao com runbook e MTTR documentado.

| Incidente | Tipo | Severidade | Impacto | MTTR |
|---|---|---|---|---|
| INC-004 | Imagem invalida (ErrImagePull) | Aviso | Zero downtime, maxUnavailable:0 protegeu o servico | 6 min |
| INC-003 | Secret ausente (ContainerConfigError) | Aviso | Zero downtime, pods antigos continuaram servindo | 5 min |
| INC-002 | OOMKilled (container sem memoria) | Critico | Pod em CrashLoop, sem impacto em producao | 4 min |
| INC-001 | RDS indisponivel (rds_iam revogado) | Critico | 503 total, readinessProbe bloqueou o ALB | 4 min |

**INC-004 (Aviso)**
![INC-004](docs/architecture/screenshots/inc-004-alert-v2.png)

**INC-002 (Critico)**
![INC-002](docs/architecture/screenshots/inc-002-alert.png)

**INC-001 (Critico)**
![INC-001](docs/architecture/screenshots/inc-001-alert.png)

Para reproduzir os incidentes com alertas reais no Grafana: ver [docs/incidents/](docs/incidents/) e usar a skill `/bo-real-prod`.

## Acesso rapido

```bash
# Grafana (Platform Alerts dashboard e a home)
kubectl port-forward svc/vm-grafana -n monitoring 3000:80
# http://localhost:3000

# ArgoCD
kubectl port-forward svc/argocd-server -n argocd 8080:443
# https://localhost:8080

# ALB endpoint
kubectl get ingress devops-ia -n app -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

## Documentacao

| Documento | Conteudo |
|---|---|
| [docs/setup/](docs/setup/README.md) | Passo a passo para recriar o ambiente do zero |
| [docs/architecture/](docs/architecture/overview.md) | Stacks Terraform, IRSA, pipelines, seguranca, ADRs |
| [docs/incidents/](docs/incidents/) | Incidentes simulados com timeline e MTTR real |
| [docs/runbooks/](docs/runbooks/) | Runbooks operacionais para falhas conhecidas |

## Roadmap

- Loki + Grafana Alloy: agregacao de logs dos pods
- Tempo: distributed tracing com OpenTelemetry
- Alertmanager: routing de alertas Kubernetes
- External Secrets Operator: integracao com AWS Secrets Manager
