# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevOps/SRE portfolio platform on AWS running a real application: **Incident Tracker** (incident management system). Backend is Node.js 20 + Express + TypeScript + Prisma ORM; frontend is Next.js 14 + Tailwind CSS. Database is RDS PostgreSQL 16 with IAM Database Authentication via IRSA — no static passwords anywhere. All application workloads run in the `app` namespace.

Stacks are independent directories prefixed with a two-digit number (e.g. `01-networking-stack-ai`). The `00-remote-backend-stack-ai` stack (if it exists) is always excluded from bulk operations.

### Directory Structure

- `devops-ia-terraform/` — Terraform stacks for AWS infrastructure (stacks 00-05)
- `devops-ia-apps/` — Application source code
  - `backend/` — Node.js + TypeScript + Prisma; `src/lib/prisma.ts` generates IAM tokens via `@aws-sdk/rds-signer`
  - `backend/prisma/` — Prisma schema and versioned migrations (`migrations/0_init/`)
  - `frontend/devops-ia-platform/` — Next.js 14 + Tailwind CSS
- `devops-ia-kubernetes/` — Kubernetes manifests organized by application
  - `storage/` — StorageClass gp3 (default cluster StorageClass)

### Terraform Stacks (00-05)

| Stack | What it creates |
|---|---|
| `00-remote-backend-stack-ai` | S3 bucket for Terraform state + DynamoDB lock table |
| `01-networking-stack-ai` | VPC multi-AZ, public/private subnets (3 AZs), NAT Gateway, Flow Logs |
| `02-eks-stack-ai` | EKS cluster 1.31, Managed Node Group (4x t3.small), ECR repos, OIDC Provider |
| `03-ci-cd-stack-ai` | GitHub OIDC Identity Provider + IAM Role `devops-ia-production-github-actions` |
| `04-addons-stack-ai` | metrics-server, AWS Load Balancer Controller, EBS CSI Driver addon (IRSA), StorageClass gp3 |
| `05-database-stack-ai` | RDS PostgreSQL 16, IRSA role for backend, SG, CloudWatch alarms, SNS |

## Agents

Four specialized agents are defined in `.claude/agents/`:

- **`devops-solution-architect`** — Plans architectures and produces ADRs only. Never creates `.tf` files or any infrastructure code. Invoked before implementation begins.
- **`devops-senior-engineer`** — Reads ADRs and implements IaC. Invoked after an ADR is approved.
- **`devsecops-senior-engineer`** — Reviews code, Terraform, Kubernetes manifests, Dockerfiles, and GitHub Actions for secrets, credentials, and dangerous configurations before commit or push. Returns a structured APPROVED or BLOQUEADO verdict.
- **`postgres-rds-db-senior`** — Designs, reviews, and implements the RDS PostgreSQL database layer. Covers architecture decisions, Terraform modules, security (no public access, no secrets in Git), backend integration, observability, and incident runbooks.

## Skills

Skills are defined in `.claude/skills/`:

- **`terraform-deploy`** — Deploys Terraform stacks (`fmt` → `validate` → `plan` → `apply`)
- **`dockerfile-generator`** — Generates optimized Dockerfiles (multi-stage, alpine, rootless, healthcheck)
- **`docker-push-ecr`** — Builds and pushes Docker images to ECR
- **`resolve-bo-inicial`** — Full rebuild runbook: clean infra, Terraform, RDS user setup, secrets, images, kustomize deploy, ArgoCD, monitoring. Invoke whenever doing a fresh deploy from scratch.

## Deploy Workflow

Use the `terraform-deploy` skill (`.claude/skills/terraform-deploy/`):

```bash
# Deploy a specific stack
/terraform-deploy 01-networking-stack-ai

# Deploy all stacks (sequential, excludes 00-remote-backend-stack-ai)
/terraform-deploy
```

The skill runs: `fmt` → `validate` → `plan` (prints output) → `apply -auto-approve`, always passing `-var-file="envs/production.tfvars"` when present.

## Fresh Deploy (Rebuild from Scratch)

Use the `resolve-bo-inicial` skill whenever destroying and recreating all infrastructure.
The full sequence after Terraform completes is **not just kubectl apply** — there are manual steps:

1. `aws eks update-kubeconfig --name devops-ia-production --region us-east-1`
2. **RDS user setup** (required on every fresh RDS): create `app_user`, grant `rds_iam` and schema permissions via a temporary pod — see skill for exact commands
3. **Build and push images** to ECR with both `sha-<git-sha>` and `latest` tags
4. **Update `kustomization.yaml`** with the new SHA tag, commit and push to `clean-main`
5. Create namespace `app` and `backend-secrets` (IAM token + JWT — token expires in 15 min)
6. `kubectl apply -k devops-ia-kubernetes/` — always use kustomize, never individual files
7. Verify migration job completes before pods start receiving traffic
8. Create namespace `monitoring` and `grafana-admin-secret`
9. Install ArgoCD with `--server-side --force-conflicts` (CRDs are too large for client-side apply)
10. Apply `argocd-application.yaml` and `monitoring-application.yaml`

**Critical gotchas:**
- Never `kubectl apply -f` individual deployment files — kustomize must set the image tag
- The `kustomization.yaml` must not have `commonLabels` — it makes Deployment selectors immutable and breaks ArgoCD sync
- The S3 state bucket uses versioning — when cleaning, delete all versions and delete markers, not just current objects
- Terraform state lock files (`*.tflock`) in S3 must be deleted manually if a previous apply was interrupted

## Manual Terraform Commands

```bash
cd 01-networking-stack-ai
terraform fmt
terraform validate
terraform plan  -var-file="envs/production.tfvars"
terraform apply -var-file="envs/production.tfvars"
terraform destroy -var-file="envs/production.tfvars"
```

## MCP Servers

Configured in `.mcp.json`:
- **`terraform`** — Validates provider versions and resources before writing IaC. Always query before citing a provider version or resource.
- **`aws-mcp`** — Validates AWS services, regional availability, and best practices. Always query before citing AWS service behaviour or pricing.

## Documentation Structure

- `docs/` — ADRs produced by the architect agent (`ADR-XXXX-title.md`)
- `docs/implementation/` — Implementation records produced by the engineer agent (`IMPL-ADR-XXXX-YYYY-MM-DD.md`)

## Writing Style

Full rules in `.claude/rules/writing-style.md`. Key point: **no em-dashes (travessão "—") anywhere** — not in job names, step names, workflow names, PR titles, commit messages, or any user-visible text. Write names naturally: `Frontend SAST (Semgrep)`, not `SAST — Frontend (Semgrep)`.

## Terraform Conventions

Full rules in `.claude/rules/terraform-naming-conventions.md`. Key points:

**File naming** — dot-separated semantic hierarchy:
```
vpc.tf                    # aws_vpc + aws_internet_gateway
vpc.public-subnets.tf
vpc.private-subnets.tf
vpc.public-route-table.tf
vpc.private-route-table.tf
vpc.nat-gateway.tf
vpc.flow-logs.tf
```

**Variables** — grouped objects, no `default` values:
```hcl
variable "vpc" {
  type = object({
    name                 = string
    cidr                 = string
    public_subnet_cidrs  = list(string)
    private_subnet_cidrs = list(string)
    ...
  })
}
```

**Variable values** — per-environment files, never `terraform.tfvars`:
```
envs/production.tfvars
envs/staging.tfvars
envs/dev.tfvars
```

**Resource identifiers** — no type repetition, always singular:
```hcl
resource "aws_route_table" "public" {}   # correct
resource "aws_route_table" "public_route_table" {}  # wrong
```

**Block ordering** — `count`/`for_each` first, `tags` last (before `depends_on`/`lifecycle`).

**Providers** — native `hashicorp/aws` resources only. No community modules.

## Kubernetes Conventions

Full rules in `.claude/rules/kubernetes-manifests.md`. Key points:

**File structure** — one resource per file, organized by application:
```
devops-ia-kubernetes/
├── backend/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── pdb.yaml
└── frontend/
    ├── deployment.yaml
    ├── service.yaml
    └── pdb.yaml
```

**Required for every Deployment:**
- Labels: `app.kubernetes.io/name`, `version`, `component`, `part-of`, `managed-by`, `environment`
- Minimum 2 replicas
- RollingUpdate strategy (maxUnavailable: 0)
- readinessProbe + livenessProbe
- Resources (requests/limits)
- Service NodePort
- PodDisruptionBudget

**Security (non-negotiable):**
- `runAsNonRoot: true`, `runAsUser: 1001`
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`, drop ALL capabilities
- Volumes mounted `readOnly: true` (except emptyDir for tmp/cache)
